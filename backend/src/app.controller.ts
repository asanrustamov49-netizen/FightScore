import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/auth/auth.guard.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Liveness and database reachability; used by clients to show the connection indicator. */
  @Public()
  @Get('health')
  health() {
    return this.appService.health();
  }
}
