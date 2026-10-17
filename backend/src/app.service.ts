import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database/database.service.js';

@Injectable()
export class AppService {
  constructor(private readonly db: DatabaseService) {}

  async health() {
    try {
      const row = await this.db.one<{ ms: number }>(`SELECT floor(extract(epoch FROM now()) * 1000)::bigint AS ms`);
      return { status: 'ok', database: 'ok', serverTime: Number(row!.ms) };
    } catch {
      return { status: 'degraded', database: 'unavailable', serverTime: Date.now() };
    }
  }
}
