import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body ของ `POST /device-firmware-overrides/{id}/reject` (Sprint 3 แถวที่
 * 24) — `rejectReason` ไม่บังคับ (Operation อาจไม่ระบุเหตุผลก็ได้ ต่างจาก
 * `reason` ตอนส่งคำขอ override ที่บังคับ) mirror
 * `RejectDeviceConfigOverrideDto` ทุกประการ */
export class RejectDeviceFirmwareOverrideDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectReason?: string;
}
