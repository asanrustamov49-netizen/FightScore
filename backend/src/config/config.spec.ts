import { isOriginAllowed, loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db' } as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('enables self-registration by default only in dev-http', () => {
    expect(loadConfig({ ...base }).allowRegistration).toBe(true);
    expect(loadConfig({ ...base, DEPLOY_MODE: 'production', PUBLIC_ORIGINS: 'https://fs.example' }).allowRegistration).toBe(false);
  });

  it('lets ALLOW_REGISTRATION override the default', () => {
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: 'false' }).allowRegistration).toBe(false);
    expect(loadConfig({ ...base, DEPLOY_MODE: 'production', PUBLIC_ORIGINS: 'https://fs.example', ALLOW_REGISTRATION: 'true' }).allowRegistration).toBe(true);
  });

  it('refuses production without https origins', () => {
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'production' })).toThrow(/https/);
  });

  it('rejects an invalid port instead of falling back to a default', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });

  it('keeps sessions for 30 days since the last visit by default', () => {
    expect(loadConfig({ ...base }).SESSION_TTL_HOURS).toBe(720);
  });

  it('accepts any loopback origin in dev-http, only listed origins in production', () => {
    const dev = loadConfig({ ...base });
    expect(isOriginAllowed(dev, 'http://localhost:3001')).toBe(true);
    expect(isOriginAllowed(dev, 'http://127.0.0.1:3100')).toBe(true);
    expect(isOriginAllowed(dev, 'http://[::1]:3002')).toBe(true);
    expect(isOriginAllowed(dev, 'http://localhost.evil.test:3000')).toBe(false);
    expect(isOriginAllowed(dev, 'http://192.168.1.5:3000')).toBe(false);
    const prod = loadConfig({ ...base, DEPLOY_MODE: 'production', PUBLIC_ORIGINS: 'https://fs.example' });
    expect(isOriginAllowed(prod, 'https://fs.example')).toBe(true);
    expect(isOriginAllowed(prod, 'http://localhost:3000')).toBe(false);
  });
});
