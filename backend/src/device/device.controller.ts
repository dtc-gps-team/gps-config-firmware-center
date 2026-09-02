import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import type { DeviceConnectionTestResult } from './device-connection-tester';
import { DeviceService } from './device.service';

// Device module — รอบนี้ทำแค่ `POST /devices/:deviceId/test-connection`
// (ทดสอบสัญญาณอุปกรณ์ที่ติดตั้งจริง สำหรับช่างหน้างาน ST/OT ผ่าน Mobile)
//
// **ไม่ implement `GET /devices/:deviceId/status`** ในรอบนี้ — มีแต่ spec ใน
// openapi.yaml ยังไม่เคยมีโค้ดจริง และตกลงกับ paveekornkwork-dev (A) บน
// คอมเมนต์ PR #52 ว่าตัดออก เพราะการคำนวณ configStatus/firmwareStatus ต้อง
// ออกแบบใหม่ทั้งก้อน (Device ไม่มี FK ตรงไป Config/Firmware) — เป็น PR แยกในอนาคต
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

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
}
