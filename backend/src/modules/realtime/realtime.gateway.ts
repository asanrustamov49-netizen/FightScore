import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Namespace, Socket } from 'socket.io';
import { loadConfig } from '../../config/config.js';
import { AppError, fromPgError } from '../../common/errors.js';
import { parse, uuid } from '../../common/validation.js';
import { AuthService, type SessionUser } from '../auth/auth.service.js';
import { DisplaysService } from '../displays/displays.service.js';
import { MatchesService } from '../matches/matches.service.js';
import { ScoringService } from '../scoring/scoring.service.js';

const origins = () => loadConfig().publicOrigins;

function originAllowed(socket: Socket) {
  const origin = socket.handshake.headers.origin;
  return !origin || origins().includes(origin);
}

const wsLogger = new Logger('Realtime');

/** Domain errors go to the client as-is; anything else is logged and reported generically. */
function fail(err: unknown) {
  if (err instanceof AppError) return { ok: false, error: err.toJSON() };
  const mapped = fromPgError(err);
  if (mapped) return { ok: false, error: mapped.toJSON() };
  wsLogger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  return { ok: false, error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } };
}

const matchRoom = (id: string) => `m:${id}`;
const publicRoom = (id: string) => `p:${id}`;
const displayRoom = (id: string) => `d:${id}`;

/** Read-only channel for TV displays. Accepts no commands. */
@WebSocketGateway({ namespace: '/public', cors: { origin: origins(), credentials: false } })
export class PublicGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private subs: Subscription[] = [];
  @WebSocketServer() private readonly ns!: Namespace;

  constructor(private readonly displays: DisplaysService) {}

  sendMatch(matchId: string, view: unknown) {
    this.ns.to(publicRoom(matchId)).emit('display.match', view);
  }

  onModuleInit() {
    this.subs.push(
      this.displays.changes.subscribe(async ({ displayId, revokedToken }) => {
        const sockets = await this.ns.in(displayRoom(displayId)).fetchSockets();
        for (const s of sockets) {
          if (revokedToken && s.data.token === revokedToken) {
            s.emit('display.revoked');
            s.disconnect(true);
            continue;
          }
          for (const room of s.rooms) if (room.startsWith('p:')) s.leave(room);
          const view = await this.displays.publicView(s.data.token).catch(() => null);
          if (view?.match) s.join(publicRoom(view.match.matchId));
          s.emit('display.state', view);
        }
      }),
    );
  }

  onModuleDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }

  handleConnection(socket: Socket) {
    if (!originAllowed(socket)) socket.disconnect(true);
  }

  @SubscribeMessage('time.sync')
  timeSync() {
    return { serverTime: Date.now() };
  }

  @SubscribeMessage('display.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { token?: unknown }) {
    try {
      if (typeof body?.token !== 'string' || body.token.length > 100) throw new AppError('VALIDATION', 'Неверный токен табло');
      const view = await this.displays.publicView(body.token);
      socket.data.token = body.token;
      await socket.join(displayRoom(view.display.id));
      if (view.match) await socket.join(publicRoom(view.match.matchId));
      return { ok: true, view };
    } catch (err) {
      return fail(err);
    }
  }
}

/** Authenticated channel for organizers and officials. Every subscription and command is authorized. */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: origins(), credentials: false } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private subs: Subscription[] = [];
  @WebSocketServer() private readonly ns!: Namespace;

  constructor(
    private readonly auth: AuthService,
    private readonly matches: MatchesService,
    private readonly scoring: ScoringService,
    private readonly publicGateway: PublicGateway,
  ) {}

  onModuleInit() {
    this.subs.push(this.scoring.changes.subscribe(({ matchId }) => void this.broadcast(matchId)));
  }

  onModuleDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }

  /**
   * Authentication runs as namespace middleware, so the connection is accepted only after the ticket
   * was checked. (An async handleConnection lets the client's first message race ahead of it.)
   */
  afterInit(ns: Namespace) {
    ns.use((socket, next) => {
      if (!originAllowed(socket)) return next(new Error('FORBIDDEN_ORIGIN'));
      this.auth.consumeTicket(socket.handshake.auth?.ticket).then(
        (user) => {
          if (!user) return next(new Error('UNAUTHENTICATED'));
          socket.data.user = user;
          next();
        },
        (err) => {
          this.logger.error(`ticket check failed: ${(err as Error).message}`);
          next(new Error('UNAVAILABLE'));
        },
      );
    });
  }

  handleConnection(socket: Socket) {
    // Defensive: middleware guarantees a user; never serve a socket without one.
    if (!socket.data.user) socket.disconnect(true);
  }

  @SubscribeMessage('time.sync')
  timeSync() {
    return { serverTime: Date.now() };
  }

  @SubscribeMessage('match.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { matchId?: unknown }) {
    try {
      const user = socket.data.user as SessionUser;
      const matchId = parse(uuid, body?.matchId);
      await this.matches.requireView(user.id, matchId);
      await socket.join(matchRoom(matchId));
      const snap = await this.matches.snapshot(matchId);
      const viewer = await this.matches.viewer(user.id, matchId, snap.tournament.id, snap.rules?.definition ?? null);
      return { ok: true, snapshot: { ...snap, viewer } };
    } catch (err) {
      return fail(err);
    }
  }

  @SubscribeMessage('match.unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { matchId?: string }) {
    if (typeof body?.matchId === 'string') await socket.leave(matchRoom(body.matchId));
    return { ok: true };
  }

  @SubscribeMessage('match.command')
  async command(@ConnectedSocket() socket: Socket, @MessageBody() body: { matchId?: unknown }) {
    try {
      const result = await this.scoring.executeUntrusted(String(body?.matchId), body, socket.data.user as SessionUser);
      return { ok: true, result };
    } catch (err) {
      return fail(err);
    }
  }

  /** Sends the committed snapshot to subscribed officials and to displays showing the match. */
  private async broadcast(matchId: string) {
    try {
      const snap = await this.matches.snapshot(matchId);
      this.ns.to(matchRoom(matchId)).emit('match.state', snap);
      this.publicGateway.sendMatch(matchId, this.matches.publicView(snap));
    } catch (err) {
      this.logger.error(`broadcast failed for ${matchId}: ${(err as Error).message}`);
    }
  }
}
