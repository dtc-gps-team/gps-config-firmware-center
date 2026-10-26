import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body ของ `POST /config-apply-requests/{id}/reject` (docs/25 §3.4) —
 * `rejectReason` **บังคับ** ต่างจาก Device Config Override ที่ไม่บังคับ:
 * ช่างต้องรู้ว่าต้องแก้อะไรก่อนขอส่งอีกครั้ง */
export class RejectConfigApplyRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rejectReason!: string;
}
