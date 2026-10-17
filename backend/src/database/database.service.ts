import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { pgOptions } from './pg-options.js';

export type Db = pg.Pool | pg.PoolClient;

// Return bigint columns (seq, version) as JS numbers; values stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
// Keep DATE columns as 'YYYY-MM-DD' strings instead of shifting them through local time.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: pg.Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({
      ...pgOptions(config.DATABASE_URL, config),
      max: 10,
      keepAlive: true,
      // Remote poolers (Supabase) can be slow to connect and drop idle connections.
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 60_000,
    });
    // A dropped idle connection must not crash the process; the next query opens a new one.
    this.pool.on('error', (err) => this.logger.warn(`idle database connection lost: ${err.message}`));
  }

  private readonly logger = new Logger('Database');

  async query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = [], db: Db = this.pool): Promise<T[]> {
    const res = await db.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = [], db: Db = this.pool): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params, db);
    return rows[0];
  }

  /** Runs `fn` inside a transaction; rolls back on any thrown error. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
