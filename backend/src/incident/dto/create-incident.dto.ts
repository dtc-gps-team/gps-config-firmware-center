import { IncidentSeverity } from '@prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { INCIDENT_SEVERITIES } from '../incident-status';

/**
 * Body ของ `POST /incidents` (issue #236 — Field Incident Report) — ST/OT
 * แจ้งปัญหาที่เจอกับอุปกรณ์ผ่าน Mobile · `reportedBy`/`source`/`status` ไม่รับ
 * จาก client เลย (`reportedBy` มาจาก JWT, `source` fix เป็น `'field-report'`,
 * `status` fix เป็น `'open'` เสมอ — mirror `DeviceConfigOverrideDto` ที่ไม่รับ
 * `overriddenBy`/`status` จาก client เช่นกัน) `title`/`description` บังคับทั้งคู่
 * (ตาม design ที่ตกลงกับ B ใน issue #236 — report ที่มีแต่หัวข้อทำให้ Operation
 * ตัดสินใจ/ไล่ปัญหาลำบาก มิเรอร์เหตุผลเดียวกับที่ `note` ของ `DecideIncidentDto`
 * บังคับเสมอ — แก้ตามรีวิว B บน PR #267)
 */
export class CreateIncidentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @IsIn(INCIDENT_SEVERITIES)
  severity!: IncidentSeverity;

  /** `Device.deviceId` (เลขเครื่องจริง) — optional เพราะบางปัญหาอาจไม่ผูกกับ
   * อุปกรณ์เครื่องใดเครื่องหนึ่งชัดเจน (เช่น ปัญหาทั่วไปของรุ่นอุปกรณ์) */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string;
}
