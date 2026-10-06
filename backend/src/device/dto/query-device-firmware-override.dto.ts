import { DeviceFirmwareOverrideStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { DEVICE_FIRMWARE_OVERRIDE_STATUSES } from '../device-firmware-override-status';

/** Query ของ `GET /device-firmware-overrides` (Sprint 3 แถวที่ 24) — `status`
 * optional ไม่ส่งมา = คืนทุกสถานะ · Operation ใช้ `?status=pending` ดูคิวคำขอ
 * รออนุมัติ mirror `QueryDeviceConfigOverrideDto` ทุกประการ */
export class QueryDeviceFirmwareOverrideDto {
  @IsOptional()
  @IsIn(DEVICE_FIRMWARE_OVERRIDE_STATUSES)
  status?: DeviceFirmwareOverrideStatus;
}
