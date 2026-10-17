import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { parseCookies, sessionCookieName } from '../../common/cookies.js';
import { AppError } from '../../common/errors.js';
import { AuthService, type SessionUser } from './auth.service.js';

export type AuthedRequest = Request & { user?: SessionUser | null; sessionToken?: string };

const PUBLIC_KEY = 'fs:public';
/** Marks a route as reachable without a session (login, public display data). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user as SessionUser;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? null;
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: CSRF check for state-changing requests (custom header + Origin allowlist),
 * then session resolution. Permission checks happen in services via AccessService.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!SAFE_METHODS.has(req.method)) {
      if (req.headers['x-fightscore-request'] !== '1') throw new AppError('CSRF', 'Запрос отклонён: нет заголовка X-FightScore-Request');
      const origin = req.headers.origin;
      if (origin && !this.config.publicOrigins.includes(origin)) throw new AppError('CSRF', 'Запрос отклонён: недопустимый Origin');
    }
    const token = parseCookies(req.headers.cookie)[sessionCookieName(this.config)];
    req.sessionToken = token;
    req.user = await this.auth.resolve(token);
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!isPublic && !req.user) throw new AppError('UNAUTHENTICATED', 'Требуется вход в систему');
    return true;
  }
}
