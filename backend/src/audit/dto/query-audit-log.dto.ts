import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query ของ `GET /audit-logs` (Sprint 3 #27) — ทุก filter optional ไม่ส่งอะไร
 * มา = คืนทุกรายการ เรียงตาม `createdAt desc` (ใหม่สุดก่อน) · mirror
 * `QueryIncidentDto`
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
}
