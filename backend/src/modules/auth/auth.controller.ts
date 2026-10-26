import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { clearSessionCookie, sessionCookie } from '../../common/cookies.js';
import { MIN_PASSWORD_LENGTH } from '../../common/password.js';
import { login as loginField, parse } from '../../common/validation.js';
import { AccessService } from '../access/access.service.js';
import { type AuthedRequest, ClientIp, CurrentUser, Public } from './auth.guard.js';
import { AuthService, type SessionUser } from './auth.service.js';

const loginSchema = z.object({ login: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) });

const registerSchema = z.object({
  login: loginField,
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Пароль не короче ${MIN_PASSWORD_LENGTH} символов`).max(200),
});

const profileSchema = z.object({ displayName: z.string().trim().min(1, 'Укажите имя').max(120) });

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Укажите текущий пароль').max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Пароль не короче ${MIN_PASSWORD_LENGTH} символов`).max(200),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null) {
    const { login, password } = parse(loginSchema, body);
    const { token, ttl, user } = await this.auth.login(login, password, ip, req.headers['user-agent'] ?? null);
    res.setHeader('Set-Cookie', sessionCookie(this.config, token, ttl));
    return this.profile(user);
  }

  /** The platform administrator's own door: accepts only that account; a shorter session (see ADMIN_SESSION_TTL_SEC). */
  @Public()
  @Post('admin/login')
  @HttpCode(200)
  async adminLogin(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null) {
    const { login, password } = parse(loginSchema, body);
    const { token, ttl, user } = await this.auth.login(login, password, ip, req.headers['user-agent'] ?? null, 'admin');
    res.setHeader('Set-Cookie', sessionCookie(this.config, token, ttl));
    return this.profile(user);
  }

  /** Public: what the sign-in screen may offer. Contains no user data. */
  @Public()
  @Get('options')
  options() {
    return { registration: this.config.allowRegistration, minPasswordLength: MIN_PASSWORD_LENGTH };
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null) {
    const input = parse(registerSchema, body);
    const { token, user } = await this.auth.register(input, ip, req.headers['user-agent'] ?? null);
    res.setHeader('Set-Cookie', sessionCookie(this.config, token, this.auth.sessionTtlSec));
    return this.profile(user);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null) {
    await this.auth.logout(req.sessionToken, req.user ?? null, ip);
    res.setHeader('Set-Cookie', clearSessionCookie(this.config));
  }

  /** Current user; also renews the session and its cookie (sliding expiry, see AuthService.renew). */
  @Get('me')
  async me(@CurrentUser() user: SessionUser, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const [profile, ttl] = await Promise.all([this.profile(user), this.auth.renew(req.sessionToken)]);
    if (ttl) res.setHeader('Set-Cookie', sessionCookie(this.config, req.sessionToken!, ttl));
    return profile;
  }

  /** Own display name. Login and roles are not editable here: roles come only from an administrator or organizer. */
  @Put('me')
  async updateMe(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { displayName } = parse(profileSchema, body);
    return this.profile(await this.auth.updateProfile(user, displayName, ip));
  }

  @Post('password')
  @HttpCode(200)
  async password(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: AuthedRequest, @ClientIp() ip: string | null) {
    const { currentPassword, newPassword } = parse(passwordSchema, body);
    return this.auth.changePassword(user, req.sessionToken, currentPassword, newPassword, ip);
  }

  /** One-time ticket for the realtime socket handshake. */
  @Post('realtime-ticket')
  @HttpCode(200)
  ticket(@CurrentUser() user: SessionUser) {
    return { ticket: this.auth.issueTicket(user.id) };
  }

  private async profile(user: SessionUser) {
    // Independent reads in parallel: one network round trip on a remote database instead of three.
    const [roles, grants, officiates] = await Promise.all([
      this.access.roles(user.id),
      this.access.grants(user.id),
      this.access.officiatesAnyMatch(user.id),
    ]);
    return {
      user,
      roles,
      permissions: [...new Set(grants.filter((g) => g.scope_type === 'system').map((g) => g.permission))],
      // Which entry points make sense for this user (any scope). The server still checks every action.
      capabilities: {
        organizer: grants.some((g) => ['tournament.manage', 'tournament.create'].includes(g.permission)),
        judge: grants.some((g) => g.permission === 'match.officiate') || officiates,
        displays: grants.some((g) => g.permission === 'display.operate'),
        platformAdmin: roles.some((r) => r.code === 'owner'),
      },
      deployMode: this.config.DEPLOY_MODE,
    };
  }
}
