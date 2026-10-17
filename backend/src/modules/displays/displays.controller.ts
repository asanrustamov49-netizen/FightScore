import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ClientIp, CurrentUser, Public } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { DisplaysService } from './displays.service.js';

@Controller()
export class DisplaysController {
  constructor(private readonly displays: DisplaysService) {}

  @Get('displays')
  list(@CurrentUser() user: SessionUser) {
    return this.displays.list(user);
  }

  @Post('displays')
  create(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.displays.create(user, body, ip);
  }

  @Put('displays/:id/match')
  assign(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    return this.displays.assign(user, id, body, ip);
  }

  @Post('displays/:id/rotate-token')
  rotate(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    return this.displays.rotateToken(user, id, ip);
  }

  /** Initial load for the TV page; live updates come over the `/public` socket namespace. */
  @Public()
  @Get('public/displays/:token')
  publicView(@Param('token') token: string) {
    return this.displays.publicView(token);
  }
}
