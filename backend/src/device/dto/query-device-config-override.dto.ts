import { DeviceConfigOverrideStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { DEVICE_CONFIG_OVERRIDE_STATUSES } from '../device-config-override-status';

/** Query ของ `GET /device-config-overrides` (issue #223) — `status` optional
 * ไม่ส่งมา = คืนทุกสถานะ · Operation ใช้ `?status=pending` ดูคิวคำขอรออนุมัติ */
export class QueryDeviceConfigOverrideDto {
  @IsOptional()
  @IsIn(DEVICE_CONFIG_OVERRIDE_STATUSES)
  status?: DeviceConfigOverrideStatus;
}
