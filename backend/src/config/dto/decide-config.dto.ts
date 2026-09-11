import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Body ของ `POST /config/{id}/decide` (Stage 4) — SW ปักผลตัดสินใจเองหลังดู
 * ผล `simulate` แล้ว ตาม docs/api/openapi.yaml `decideConfig` requestBody
 * (global ValidationPipe เป็น whitelist + forbidNonWhitelisted อยู่แล้ว)
 */
export class DecideConfigDto {
  @IsBoolean()
  passed!: boolean;

  /**
   * (optional) user id ของ Operation ที่ SW อยากเจาะจงให้ดู Config นี้เป็น
   * พิเศษ — ใช้เฉพาะตอน `passed: true` (Approval Center — Sprint 3 #19) ·
   * backend เช็คว่าเป็น role Operation ที่ active จริง (400 ถ้าไม่ใช่) ·
   * **ไม่ผูกมัด**: Operation คนอื่นก็ยัง approve Config นี้ได้
   */
  @IsOptional()
  @IsUUID()
  suggestedApproverId?: string;
}
