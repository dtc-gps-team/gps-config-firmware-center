import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body ของ `POST /config-deletion-requests/{id}/reject` (docs/11 §5) —
 * SuperAdmin ต้องระบุเหตุผลที่ไม่อนุมัติให้ลบ เก็บลง `decisionNote` ให้ผู้สร้าง
 * Config เห็น · required (ตาราง §5 ระบุ `body { note }`) · global ValidationPipe
 * เป็น whitelist + forbidNonWhitelisted อยู่แล้ว ไม่รับ field อื่น */
export class RejectConfigDeletionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}
