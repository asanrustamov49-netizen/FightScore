import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AllExceptionsFilter } from './common/errors.js';
import { APP_CONFIG, loadConfig } from './config/config.js';
import { DatabaseService } from './database/database.service.js';
import { AccessService } from './modules/access/access.service.js';
import { AthletesController } from './modules/athletes/athletes.controller.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthService } from './modules/auth/auth.service.js';
import { DisplaysController } from './modules/displays/displays.controller.js';
import { DisplaysService } from './modules/displays/displays.service.js';
import { MatchesController } from './modules/matches/matches.controller.js';
import { MatchesService } from './modules/matches/matches.service.js';
import { PublicGateway, RealtimeGateway } from './modules/realtime/realtime.gateway.js';
import { RulesController } from './modules/rules/rules.controller.js';
import { ScoringController } from './modules/scoring/scoring.controller.js';
import { ScoringService } from './modules/scoring/scoring.service.js';
import { TournamentsController } from './modules/tournaments/tournaments.controller.js';
import { AdminController, UsersController } from './modules/users/users.controller.js';

/**
 * MVP keeps one Nest module; module boundaries are the folders under src/modules
 * and follow the dependency graph in docs/ARCHITECTURE.md §4.2.
 */
@Module({
  controllers: [
    AppController,
    AuthController,
    UsersController,
    AdminController,
    AthletesController,
    TournamentsController,
    MatchesController,
    ScoringController,
    DisplaysController,
    RulesController,
  ],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    AppService,
    DatabaseService,
    AuditService,
    AccessService,
    AuthService,
    MatchesService,
    ScoringService,
    DisplaysService,
    PublicGateway,
    RealtimeGateway,
  ],
})
export class AppModule {}
