import { loadConfig } from './config.js';

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
});
