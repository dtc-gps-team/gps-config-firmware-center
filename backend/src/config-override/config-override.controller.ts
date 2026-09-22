import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType, Config } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ActingUser, ConfigOverrideService } from './config-override.service';
import { OverrideConfigDto } from './dto/override-config.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Per-Field Config Override ACL (issue #185) — resource `config-override`
// action `Override` ให้เฉพาะ ST เท่านั้น (seed.ts) OT โดน 403 ที่ PermissionGuard
// ก่อนถึง service เลย
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class ConfigOverrideController {
  constructor(private readonly configOverrideService: ConfigOverrideService) {}

  @Post('config/:configId/override')
  @RequirePermission('config-override', ActionType.Override)
  @HttpCode(HttpStatus.OK)
  override(
    @Param('configId', ParseUUIDPipe) configId: string,
    @Body() dto: OverrideConfigDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Config> {
    return this.configOverrideService.override(configId, dto, toActor(req));
  }
}
