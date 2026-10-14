import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
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
 * `from`/`to` — ช่วงเวลาของ `createdAt` (รวมขอบทั้งสองด้าน) เป็น ISO 8601 ·
 * หน้าเว็บแปลง "วันที่ที่ผู้ใช้เลือก" เป็นช่วง 00:00:00 ถึง 23:59:59.999 ตามเวลา
 * ไทยแล้วส่งมา backend จึงไม่ต้องรู้เขตเวลาของผู้ใช้ · `actorName` ค้นชื่อ
 * ผู้ทำรายการแบบ contains ไม่สนตัวพิมพ์ ครอบคลุมบัญชีที่ปิดใช้งานแล้วด้วย (ต่างจาก
 * `GET /users` ที่คืนเฉพาะ active) เพราะ Audit Log มีไว้สืบย้อนหลัง
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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  actorName?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

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
