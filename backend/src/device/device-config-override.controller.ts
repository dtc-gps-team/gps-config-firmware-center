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
import { ActionType, DeviceConfigOverride } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { QueryDeviceConfigOverrideDto } from './dto/query-device-config-override.dto';
import { RejectDeviceConfigOverrideDto } from './dto/reject-device-config-override.dto';
import type { ActingUser } from './device.service';
import { DeviceService } from './device.service';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ — mirror device.controller.ts */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Per-device Config Override — คิวอนุมัติของ Operation (issue #223, มติ
// 2026-09-24) แยก controller จาก `device.controller.ts` โดยตั้งใจ เพราะ path
// ไม่ได้ nest ใต้ `/devices/:deviceId` (endpoint พวกนี้ทำงานกับ
// `DeviceConfigOverride.id` ตรงๆ ไม่ใช่ device) แต่ยังใช้ `DeviceService`
// ตัวเดียวกัน (โมดูลเดียวกัน ไม่ต้องแยก provider ใหม่):
//   GET  /device-config-overrides                — list (filter ?status=)
//   POST /device-config-overrides/:id/approve     — Operation อนุมัติ
//   POST /device-config-overrides/:id/reject      — Operation ปฏิเสธ
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('device-config-overrides')
export class DeviceConfigOverrideController {
  constructor(private readonly deviceService: DeviceService) {}

  // resource `device-config-override` action Read — Operation เท่านั้น (ดูคิว
  // คำขอรออนุมัติ) mirror `config-deletion` action Read สำหรับ list เดียวกัน
  @Get()
  @RequirePermission('device-config-override', ActionType.Read)
  list(
    @Query() query: QueryDeviceConfigOverrideDto,
  ): Promise<DeviceConfigOverride[]> {
    return this.deviceService.listDeviceConfigOverrides(query.status);
  }

  // resource `device-config-override` action Approve — Operation เท่านั้น
  @Post(':id/approve')
  @RequirePermission('device-config-override', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DeviceConfigOverride> {
    return this.deviceService.approveDeviceConfigOverride(id, toActor(req));
  }

  // resource เดียวกับ approve (action Approve) — mirror `config-deletion`
  // (`rejectConfigDeletionRequest` ใช้ action Approve เดียวกับ approve เพราะ
  // เป็น "สิทธิ์ตัดสินใจ" ไม่ได้แยกตามผลตัดสินใจ)
  @Post(':id/reject')
  @RequirePermission('device-config-override', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDeviceConfigOverrideDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<DeviceConfigOverride> {
    return this.deviceService.rejectDeviceConfigOverride(id, dto, toActor(req));
  }
}
