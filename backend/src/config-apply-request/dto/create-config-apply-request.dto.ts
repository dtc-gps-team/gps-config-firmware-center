import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body ของ `POST /tasks/{taskId}/config-apply-requests` (docs/25 §3.3,
 * docs/28 §5.3) — เครื่องมาจาก Task เสมอ (ไม่รับ `deviceId`) · `configId` ช่าง
 * เลือกจาก `GET /devices/{deviceId}/apply-options` ได้ ไม่ส่ง = ใช้ Config ที่
 * Operation ผูกไว้กับ Task (Mobile รุ่นก่อน docs/28 ไม่ส่ง) */
export class CreateConfigApplyRequestDto {
  @IsOptional()
  @IsUUID()
  configId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
