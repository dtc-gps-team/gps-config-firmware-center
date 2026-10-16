import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DeviceApiKeyGuard } from '../common/guards/device-api-key.guard';
import { ReportJobResultDto } from './dto/report-job-result.dto';
import {
  DeviceJobsResponse,
  DeviceSyncService,
  JobReportResponse,
} from './device-sync.service';

// device-sync module (docs/19 §4) — endpoint ที่ **อุปกรณ์เรียกเอง** ไม่ใช่ staff:
//   GET  /device-sync/:deviceId/jobs                 อุปกรณ์ดึงงาน Config ที่รออยู่
//   POST /device-sync/:deviceId/jobs/:jobId/result   อุปกรณ์รายงานผลกลับ
//
// ยืนยันตัวตนด้วย header `X-Device-Api-Key` ผ่าน `DeviceApiKeyGuard` เท่านั้น
// (ไม่ใช่ JWT เพราะอุปกรณ์ไม่ใช่ผู้ใช้) ไม่ผ่าน `PermissionGuard` และไม่มีใน
// ตารางสิทธิ์ตาม role ของ RBAC_Matrix เพราะอุปกรณ์ไม่มี role · deviceId ใน path
// ต้องตรงกับ key (guard ตรวจ) เครื่องหนึ่งใช้ key ของตัวเองเรียกงานของเครื่องอื่นไม่ได้
//
// path ใช้ `/device-sync/` แยกจาก `/devices/` ที่เป็นของ staff (JWT) ชัดเจน
@UseGuards(DeviceApiKeyGuard)
@Controller('device-sync/:deviceId')
export class DeviceSyncController {
  constructor(private readonly deviceSyncService: DeviceSyncService) {}

  @Get('jobs')
  listJobs(@Param('deviceId') deviceId: string): Promise<DeviceJobsResponse> {
    return this.deviceSyncService.listJobs(deviceId);
  }

  // 200 ทั้งกรณีบันทึกและไม่บันทึก (`accepted` บอกผล) ไม่ใช่ 201 เพราะรายงานซ้ำ
  // เป็นเรื่องปกติของอุปกรณ์ที่เน็ตหลุด
  @Post('jobs/:jobId/result')
  @HttpCode(200)
  reportResult(
    @Param('deviceId') deviceId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: ReportJobResultDto,
  ): Promise<JobReportResponse> {
    return this.deviceSyncService.reportResult(
      deviceId,
      jobId,
      dto.result,
      dto.detail,
    );
  }
}
