import { ConfigApplyRequestStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { CONFIG_APPLY_REQUEST_STATUSES } from '../config-apply-request-status';

/** Query ของ `GET /config-apply-requests` — ไม่ส่ง `status` = ทุกสถานะ ·
 * Approval Center ใช้ `?status=pending` */
export class QueryConfigApplyRequestDto {
  @IsOptional()
  @IsIn(CONFIG_APPLY_REQUEST_STATUSES)
  status?: ConfigApplyRequestStatus;
}
