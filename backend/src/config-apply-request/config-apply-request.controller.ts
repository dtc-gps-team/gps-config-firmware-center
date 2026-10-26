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
import { ActionType, ConfigApplyRequest } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import type { ActingUser } from '../task/task.service';
import {
  ConfigApplyRequestService,
  type ConfigApplyRequestView,
} from './config-apply-request.service';
import { CreateConfigApplyRequestDto } from './dto/create-config-apply-request.dto';
import { QueryConfigApplyRequestDto } from './dto/query-config-apply-request.dto';
import { RejectConfigApplyRequestDto } from './dto/reject-config-apply-request.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ — mirror task.controller.ts */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role, ipAddress: req.ip ?? null };
}

/**
 * ฝั่งช่าง (docs/25 §3.3, Q1) — ผูกกับ Task:
 *   POST /tasks/:taskId/config-apply-requests   ST/OT ผู้ถูก assign ขอส่ง
 *   GET  /tasks/:taskId/config-apply-requests   ใครเห็น Task ได้ก็เห็น (กฎของ
 *        `GET /tasks/{id}` — ไม่ใส่ PermissionGuard เหมือน task.controller.ts)
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('tasks/:taskId/config-apply-requests')
export class TaskConfigApplyRequestController {
  constructor(private readonly service: ConfigApplyRequestService) {}

  @Post()
  @RequirePermission('config-apply-request', ActionType.Create)
  create(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateConfigApplyRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigApplyRequest> {
    return this.service.create(taskId, dto, toActor(req));
  }

  @Get()
  listForTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigApplyRequest[]> {
    return this.service.listForTask(taskId, toActor(req));
  }
}

/**
 * ฝั่งคิวอนุมัติ (docs/25 §3.4, Q1):
 *   GET  /config-apply-requests?status=       Operation/Auditor/Admin/SuperAdmin
 *   POST /config-apply-requests/:id/approve   Operation (SoD เช็คที่ service)
 *   POST /config-apply-requests/:id/reject    Operation (action เดียวกับ approve)
 *   POST /config-apply-requests/:id/cancel    ผู้ขอ (action Create เดียวกับตอนขอ)
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('config-apply-requests')
export class ConfigApplyRequestController {
  constructor(private readonly service: ConfigApplyRequestService) {}

  @Get()
  @RequirePermission('config-apply-request', ActionType.Read)
  list(
    @Query() query: QueryConfigApplyRequestDto,
  ): Promise<ConfigApplyRequestView[]> {
    return this.service.list(query.status);
  }

  @Post(':id/approve')
  @RequirePermission('config-apply-request', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigApplyRequest> {
    return this.service.approve(id, toActor(req));
  }

  @Post(':id/reject')
  @RequirePermission('config-apply-request', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectConfigApplyRequestDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigApplyRequest> {
    return this.service.reject(id, dto, toActor(req));
  }

  @Post(':id/cancel')
  @RequirePermission('config-apply-request', ActionType.Create)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigApplyRequest> {
    return this.service.cancel(id, toActor(req));
  }
}
