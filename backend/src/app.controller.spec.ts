import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseService } from './database/database.service.js';

describe('AppController', () => {
  async function controllerWith(db: Partial<DatabaseService>) {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DatabaseService, useValue: db }],
    }).compile();
    return app.get(AppController);
  }

  it('reports ok with database time when the database answers', async () => {
    const controller = await controllerWith({ one: async () => ({ ms: 1234 }) as any });
    expect(await controller.health()).toEqual({ status: 'ok', database: 'ok', serverTime: 1234 });
  });

  it('reports degraded instead of failing when the database is unavailable', async () => {
    const controller = await controllerWith({
      one: async () => {
        throw new Error('connection refused');
      },
    });
    expect(await controller.health()).toMatchObject({ status: 'degraded', database: 'unavailable' });
  });
});
