import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType, Device } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import type { ConfigApplyResult } from './config-applier';
import type { DeviceConnectionTestResult } from './device-connection-tester';
import { ApplyConfigDto } from './dto/apply-config.dto';
import { QueryDeviceDto } from './dto/query-device.dto';
import { SimulateConfigOnDeviceDto } from './dto/simulate-config-on-device.dto';
import type { ActingUser } from './device.service';
import { DeviceService } from './device.service';
import type { DeviceSimulateConfigResult } from './simulate-config-result';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ — mirror config.controller.ts */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Device module:
//   GET  /devices                 — Device Search (list + filter)  · ทุก Role
//   GET  /devices/:deviceId        — Device Detail (1 เครื่อง)      · ทุก Role
//   POST /devices/:deviceId/test-connection | apply-config | simulate-config
//                                 — ช่างหน้างาน ST/OT ผ่าน Mobile
//
// **ยังไม่ implement `GET /devices/:deviceId/status`** — มีแต่ spec ใน
// openapi.yaml (schema `DeviceStatus`) ยังไม่เคยมีโค้ดจริง · การคำนวณ
// configStatus/firmwareStatus ต้องออกแบบใหม่ทั้งก้อน (Device ไม่มี FK ตรงไป
// Config/Firmware — ตกลงกับ B บน PR #52) เป็น PR แยกในอนาคต · Device Detail
// (`GET /devices/:deviceId`) รอบนี้คืนแค่ field ของ record Device เอง
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  // Device Search / Device Detail (Sprint 2 #11) — resource `devices` action
  // Read · RBAC_Matrix.md §2 แถว "Device Search / Device Detail" = R ทุก Role
  // · grant `devices` Read seed ให้ทุก role อยู่แล้ว (prisma/seed.ts — เดิม
  // เตรียมไว้ให้ getDeviceStatus ที่ยังไม่ implement) ไม่ต้อง seed เพิ่ม
  //
  // key ด้วย `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ `Device.id` (UUID
  // ภายใน) — เหมือน endpoint ช่างหน้างานด้านล่าง
  @Get()
  @RequirePermission('devices', ActionType.Read)
  findAll(@Query() query: QueryDeviceDto): Promise<Device[]> {
    return this.deviceService.findAll(query);
  }

  @Get(':deviceId')
  @RequirePermission('devices', ActionType.Read)
  findOne(@Param('deviceId') deviceId: string): Promise<Device> {
    return this.deviceService.findByDeviceId(deviceId);
  }

  // resource `device-connection-test` action Read — grant ให้ ST/OT เท่านั้น
  // (ดู prisma/seed.ts) A ยืนยันบน PR #52 ว่ายังไม่เปิดให้ SW/Operation
  // เพราะยังไม่เห็น use case ชัดเจน
  @Post(':deviceId/test-connection')
  @RequirePermission('device-connection-test', ActionType.Read)
  @HttpCode(HttpStatus.OK)
  testConnection(
    @Param('deviceId') deviceId: string,
  ): Promise<DeviceConnectionTestResult> {
    return this.deviceService.testConnection(deviceId);
  }

  // resource `device-config-apply` action Read — grant ให้ ST/OT เท่านั้น
  // (mirror `device-connection-test` — คนหน้างานที่ใช้ Mobile) SW/Operation
  // ยังไม่เปิด (ทำ Config บน Web ไม่ได้ apply หน้างาน)
  //
  // action ใช้ `Read` (ไม่ใช่ Update/Create) โดยตั้งใจ — apply-config ไม่ persist
  // อะไรในระบบเรา (fire-and-forget mock, ยืนยัน scope กับ B) จึงไม่ตรงกับ
  // Update/Create ที่หมายถึงแก้ข้อมูลใน DB — pattern เดียวกับ `config-simulation`
  @Post(':deviceId/apply-config')
  @RequirePermission('device-config-apply', ActionType.Read)
  @HttpCode(HttpStatus.OK)
  applyConfig(
    @Param('deviceId') deviceId: string,
    @Body() dto: ApplyConfigDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ConfigApplyResult> {
    return this.deviceService.applyConfig(deviceId, dto.configId, toActor(req));
  }

  // resource `device-connection-test` action Read — reuse permission เดิม
  // (ST/OT เท่านั้น) endpoint นี้เช็คสัญญาณอุปกรณ์จริงเหมือนกัน ตกลงกับ
  // kittiphong (B) บน PR #92 ว่าใช้สิทธิ์เดียวกัน ไม่ต้อง seed เพิ่ม
  //
  // action `Read` — ไม่ persist อะไร (dry-run readiness check) pattern เดียว
  // กับ `test-connection` / `apply-config`
  @Post(':deviceId/simulate-config')
  @RequirePermission('device-connection-test', ActionType.Read)
  @HttpCode(HttpStatus.OK)
  simulateConfig(
    @Param('deviceId') deviceId: string,
    @Body() dto: SimulateConfigOnDeviceDto,
  ): Promise<DeviceSimulateConfigResult> {
    return this.deviceService.simulateConfig(deviceId, dto.configId);
  }
}
