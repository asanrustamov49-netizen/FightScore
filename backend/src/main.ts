import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/config.js';
import { DatabaseService } from './database/database.service.js';
import { pendingMigrations } from './database/migrator.js';

/** The database may be briefly unreachable at startup (remote pooler, service still starting). */
async function withRetry<T>(fn: () => Promise<T>, logger: Logger, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn(`database not reachable (${(err as Error).message}), retry ${i}/${attempts - 1}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function bootstrap() {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  // Behind Render's proxy only; in a LAN X-Forwarded-* headers must not be trusted (ARCHITECTURE §9.2).
  if (config.DEPLOY_TARGET === 'cloud') app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.enableShutdownHooks();

  const pending = await withRetry(() => pendingMigrations(app.get(DatabaseService).pool, 'migrations'), logger);
  if (pending.length) {
    throw new Error(`Database has unapplied migrations: ${pending.join(', ')}. Run "npm run db:migrate".`);
  }
  if (config.DEPLOY_MODE === 'dev-http') {
    logger.warn('DEPLOY_MODE=dev-http: traffic is not encrypted. Use only on localhost or a trusted isolated network.');
  }
  if (config.DEPLOY_TARGET === 'local' && config.HOST === '0.0.0.0') {
    logger.warn('HOST=0.0.0.0 exposes the server on every network interface.');
  }
  await app.listen(config.PORT, config.HOST);
  logger.log(`FightScore API on http://${config.HOST}:${config.PORT}/api`);
}
await bootstrap();
