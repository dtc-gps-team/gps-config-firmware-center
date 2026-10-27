import { FieldApplyKind } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const FIELD_APPLY_KINDS: readonly FieldApplyKind[] = [
  'config',
  'firmware',
];

/** Body ของ `POST /tasks/{taskId}/config-apply-requests` (docs/25 §3.3,
 * docs/28 §5.3, docs/27 §5.1) — เครื่องมาจาก Task เสมอ (ไม่รับ `deviceId`)
 *
 * - `kind` ไม่ส่ง = `config` (Mobile รุ่นก่อน docs/27 B2 ไม่ส่ง)
 * - `config`: `configId` ช่างเลือกจาก `GET /devices/{deviceId}/apply-options`
 *   ได้ ไม่ส่ง = ใช้ Config ที่ Operation ผูกไว้กับ Task
 * - `firmware`: ต้องส่ง `firmwareId` และห้ามส่ง `configId` (ตรวจที่ service 400) */
export class CreateConfigApplyRequestDto {
  @IsOptional()
  @IsIn(FIELD_APPLY_KINDS)
  kind?: FieldApplyKind;

  @IsOptional()
  @IsUUID()
  configId?: string;

  @IsOptional()
  @IsUUID()
  firmwareId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
