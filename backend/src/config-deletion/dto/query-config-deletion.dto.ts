import { ConfigDeletionRequestStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';

/** ค่า status ทั้งหมดของ ConfigDeletionRequest — ตรงกับ enum ใน schema.prisma
 * (pattern เดียวกับ config-status.ts / task-status.ts) */
export const CONFIG_DELETION_REQUEST_STATUSES: readonly ConfigDeletionRequestStatus[] =
  ['pending', 'approved', 'rejected', 'cancelled'];

/** Query ของ `GET /config-deletion-requests` — `status` optional, ไม่ส่งมา =
 * `pending` (คิวที่ SuperAdmin ต้องตัดสิน · docs/11 §5) รับค่าอื่นได้เผื่อ
 * หน้าประวัติในอนาคต */
export class QueryConfigDeletionDto {
  @IsOptional()
  @IsIn(CONFIG_DELETION_REQUEST_STATUSES)
  status?: ConfigDeletionRequestStatus;
}
