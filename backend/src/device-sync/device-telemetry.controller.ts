import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  DeviceDataReportResponse,
  DeviceTelemetryService,
} from './device-telemetry.service';
import { DeviceDataReportDto } from './dto/device-data-report.dto';
import { TelemetryKeyGuard } from './telemetry-key.guard';
import { TelemetryRateLimitGuard } from './telemetry-rate-limit.guard';

// POST /device-sync/:deviceId/telemetry/:key — กล่องส่ง GPS telemetry และ event
// เข้ามาเอง (docs/23 §4) · **controller แยกจาก `DeviceSyncController`** เพราะ
// `DeviceApiKeyGuard` ระดับ controller นั้นบังคับ header `X-Device-Api-Key` ซึ่งกล่อง
// ไม่ส่งตอนคุยกับ Data Server — ใช้ key ใน path แทน (§7)
//
// ลำดับ guard: limiter ก่อน (กันเดา key ด้วย) แล้วค่อยตรวจ key · ไม่ผ่าน
// `PermissionGuard` และไม่มีแถวใน RBAC_Matrix เหมือน `/device-sync/*` เดิม (อุปกรณ์ไม่มี role)
@UseGuards(TelemetryRateLimitGuard, TelemetryKeyGuard)
@Controller('device-sync/:deviceId/telemetry')
export class DeviceTelemetryController {
  constructor(private readonly telemetryService: DeviceTelemetryService) {}

  // 200 ไม่ใช่ 201 ตาม pattern `jobs/:jobId/result` · กล่องไม่อ่าน body
  @Post(':key')
  @HttpCode(200)
  report(
    @Param('deviceId') deviceId: string,
    @Body() dto: DeviceDataReportDto,
  ): Promise<DeviceDataReportResponse> {
    return this.telemetryService.report(deviceId, dto);
  }
}
