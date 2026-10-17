import type { AppConfig } from '../config/config.js';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}

/** `__Host-` prefix requires Secure, so it is used only over HTTPS (docs/ARCHITECTURE.md §9.1). */
export function sessionCookieName(config: AppConfig) {
  return config.DEPLOY_MODE === 'production' ? '__Host-fs_session' : 'fs_session';
}

export function sessionCookie(config: AppConfig, token: string, maxAgeSec: number) {
  const parts = [`${sessionCookieName(config)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (config.DEPLOY_MODE === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(config: AppConfig) {
  return sessionCookie(config, '', 0);
}
