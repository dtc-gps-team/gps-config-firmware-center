import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body ของ `POST /tasks/{taskId}/config-apply-requests` (docs/25 §3.3) —
 * **ไม่รับ `configId`/`deviceId`** backend อ่านจาก Task เอง (ช่างเลือก Config
 * เองไม่ได้) รับแค่ข้อความถึง Operation */
export class CreateConfigApplyRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
