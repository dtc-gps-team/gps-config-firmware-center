import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body ของ `POST /device-config-overrides/{id}/reject` (issue #223) —
 * `rejectReason` ไม่บังคับ (Operation อาจไม่ระบุเหตุผลก็ได้ ต่างจาก `reason`
 * ตอนส่งคำขอ override ที่บังคับ) */
export class RejectDeviceConfigOverrideDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectReason?: string;
}
