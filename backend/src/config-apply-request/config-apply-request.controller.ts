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
  type ApplyOptions,
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
 * ตัวเลือกที่ช่างส่งเข้ากล่องได้ (docs/28 §5.2):
 *   GET /devices/:deviceId/apply-options   ST/OT (คนที่ขอส่งได้ — action Create
 *       เดียวกับตอนขอ) · อยู่ในโมดูลนี้ (ของ B) ไม่ใช่ `device` (ของ A) เพราะกฎ
 *       "ส่งได้ไหม" ต้องอยู่ที่เดียวกับที่ตรวจตอนสร้างคำขอ
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('devices/:deviceId/apply-options')
export class DeviceApplyOptionsController {
  constructor(private readonly service: ConfigApplyRequestService) {}

  @Get()
  @RequirePermission('config-apply-request', ActionType.Create)
  applyOptions(
    @Param('deviceId') deviceId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ApplyOptions> {
    return this.service.applyOptions(deviceId, toActor(req));
  }
}

/**
 * ฝั่งคิวอนุมัติ (docs/25 §3.4, Q1):
 *   GET  /config-apply-requests?status=       Operation/Auditor/Admin/SuperAdmin
 *   POST /config-apply-requests/:id/approve   Operation (SoD เช็คที่ service)
 *   POST /config-apply-requests/:id/reject    Operation (action เดียวกับ approve)
 *   POST /config-apply-requests/:id/cancel    ช่างที่ถือ Task (action Create เดียวกับตอนขอ)
 *   POST /config-apply-requests/:id/release   ช่างที่ถือ Task กดส่งเข้ากล่อง (docs/27 §5.4)
 *        — action Create เหมือน cancel (กลุ่มคนเดียวกัน ST/OT · เช็คผู้ถือ Task ที่
 *        service) แทน action `Release` ใหม่ในแผน เพราะ `ActionType` เป็น enum ที่ใช้
 *        ทั้งระบบ เพิ่มค่าแล้วกระทบ RBAC ทุก resource โดยไม่ได้ความปลอดภัยเพิ่ม
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

  @Post(':id/release')
  @RequirePermission('config-apply-request', ActionType.Create)
  @HttpCode(HttpStatus.OK)
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigApplyRequest> {
    return this.service.release(id, toActor(req));
  }
}
