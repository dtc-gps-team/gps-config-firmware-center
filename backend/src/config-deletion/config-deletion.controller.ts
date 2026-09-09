import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType, ConfigDeletionRequest } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ActingUser, ConfigDeletionService } from './config-deletion.service';
import { QueryConfigDeletionDto } from './dto/query-config-deletion.dto';
import { RejectConfigDeletionDto } from './dto/reject-config-deletion.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// docs/11 Part A — คำขอลบ Config อัตโนมัติ (§5)
//
// path/สิทธิ์:
//   GET  /config-deletion-requests            config-deletion · Read     (SuperAdmin)
//   POST /config-deletion-requests/:id/approve config-deletion · Approve  (SuperAdmin)
//   POST /config-deletion-requests/:id/reject  config-deletion · Approve  (SuperAdmin)
//   POST /config/:configId/deletion-requests/keep  config · Update        (SW / ผู้สร้าง)
//
// 3 endpoint แรก key ด้วย request id (SuperAdmin ทำงานจากคิว) · `keep` key ด้วย
// config id (SW/ผู้สร้างได้ notification เรื่อง "Config X" ไม่รู้ request id) —
// resource `config`+Update ที่ SW มีอยู่แล้ว ไม่ต้อง grant เพิ่ม
//
// `keep` ใช้ path `/config/:configId/deletion-requests/keep` ต่างจาก docs/11 §5
// (`/config-deletion-requests/:id/keep`) โดยตั้งใจ — ดูเหตุผลข้างบน · อัปเดต
// RBAC_Matrix.md §4.2 ให้ตรงกับ path จริงแล้ว
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class ConfigDeletionController {
  constructor(private readonly configDeletionService: ConfigDeletionService) {}

  @Get('config-deletion-requests')
  @RequirePermission('config-deletion', ActionType.Read)
  findRequests(
    @Query() query: QueryConfigDeletionDto,
  ): Promise<ConfigDeletionRequest[]> {
    return this.configDeletionService.findRequests(query);
  }

  @Post('config-deletion-requests/:id/approve')
  @RequirePermission('config-deletion', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigDeletionRequest> {
    return this.configDeletionService.approve(id, toActor(req));
  }

  @Post('config-deletion-requests/:id/reject')
  @RequirePermission('config-deletion', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectConfigDeletionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigDeletionRequest> {
    return this.configDeletionService.reject(id, dto.note, toActor(req));
  }

  @Post('config/:configId/deletion-requests/keep')
  @RequirePermission('config', ActionType.Update)
  @HttpCode(HttpStatus.OK)
  keep(
    @Param('configId', ParseUUIDPipe) configId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigDeletionRequest> {
    return this.configDeletionService.keep(configId, toActor(req));
  }
}
