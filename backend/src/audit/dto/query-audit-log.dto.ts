import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const AUDIT_LOG_DEFAULT_PAGE_SIZE = 20;
export const AUDIT_LOG_MAX_PAGE_SIZE = 100;

/**
 * Query ของ `GET /audit-logs` (Sprint 3 #27) — ทุก filter optional ไม่ส่งอะไร
 * มา = ทุกรายการ เรียงตาม `createdAt desc` (ใหม่สุดก่อน) · mirror
 * `QueryIncidentDto`
 *
 * `page`/`pageSize` (offset pagination) — เพิ่มทีหลังเพราะ AuditLog โตขึ้น
 * เรื่อยๆ ตามทุก mutation ในระบบ เดิมคืนทุกแถวในครั้งเดียว · `page` เริ่มที่ 1
 */
export class QueryAuditLogDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  auditModule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_LOG_MAX_PAGE_SIZE)
  pageSize?: number;
}
