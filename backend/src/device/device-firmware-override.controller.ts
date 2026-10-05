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
import { ActionType, DeviceFirmwareOverride } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { QueryDeviceFirmwareOverrideDto } from './dto/query-device-firmware-override.dto';
import { RejectDeviceFirmwareOverrideDto } from './dto/reject-device-firmware-override.dto';
import type { ActingUser } from './device.service';
import { DeviceService } from './device.service';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ — mirror device.controller.ts */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Firmware Override รายเครื่อง — คิวอนุมัติของ Operation (Sprint 3 แถวที่ 24)
// mirror `device-config-override.controller.ts` ทุกประการ — แยก controller
// จาก `device.controller.ts` โดยตั้งใจ เพราะ path ไม่ได้ nest ใต้
// `/devices/:deviceId` (endpoint พวกนี้ทำงานกับ `DeviceFirmwareOverride.id`
// ตรงๆ ไม่ใช่ device) แต่ยังใช้ `DeviceService` ตัวเดียวกัน:
//   GET  /device-firmware-overrides                — list (filter ?status=)
//   POST /device-firmware-overrides/:id/approve     — Operation อนุมัติ
//   POST /device-firmware-overrides/:id/reject      — Operation ปฏิเสธ
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('device-firmware-overrides')
export class DeviceFirmwareOverrideController {
  constructor(private readonly deviceService: DeviceService) {}

  // resource `device-firmware-override` action Read — Operation เท่านั้น
  // mirror `device-config-override` action Read สำหรับ list เดียวกัน
  @Get()
  @RequirePermission('device-firmware-override', ActionType.Read)
  list(
    @Query() query: QueryDeviceFirmwareOverrideDto,
  ): Promise<DeviceFirmwareOverride[]> {
    return this.deviceService.listDeviceFirmwareOverrides(query.status);
  }

  // resource `device-firmware-override` action Approve — Operation เท่านั้น
  @Post(':id/approve')
  @RequirePermission('device-firmware-override', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DeviceFirmwareOverride> {
    return this.deviceService.approveDeviceFirmwareOverride(id, toActor(req));
  }

  // resource เดียวกับ approve (action Approve) — "สิทธิ์ตัดสินใจ" ไม่ได้แยก
  // ตามผลตัดสินใจ mirror `device-config-override.controller.ts`
  @Post(':id/reject')
  @RequirePermission('device-firmware-override', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDeviceFirmwareOverrideDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<DeviceFirmwareOverride> {
    return this.deviceService.rejectDeviceFirmwareOverride(
      id,
      dto,
      toActor(req),
    );
  }
}
