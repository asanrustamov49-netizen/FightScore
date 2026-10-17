import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { ScoringService } from './scoring.service.js';

/** HTTP transport for match commands; the WebSocket gateway calls the same service. */
@Controller('matches/:id/commands')
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  @Post()
  @HttpCode(200)
  execute(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown) {
    return this.scoring.executeUntrusted(id, body, user);
  }
}
