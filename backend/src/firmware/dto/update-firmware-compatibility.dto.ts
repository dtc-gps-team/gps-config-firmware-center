import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * Body ของ `PATCH /firmware/{id}` (Compatibility Tag — Sprint 3 #23) — SW
 * เท่านั้น · แทนที่ทั้ง array เสมอ (ไม่ merge) mirror `updateConfig` ที่แทนที่
 * `fields` ทั้งก้อนเหมือนกัน — แก้ทีหลังหลังอัปโหลดแล้ว แยกจาก initial tag
 * ตอนอัปโหลด (`deviceModel` เดี่ยว) ตามชื่อ dev plan แถวที่ 23
 * "(อัปโหลด + Compatibility Tag)" ที่แยก 2 การกระทำไว้ชัดเจน
 */
export class UpdateFirmwareCompatibilityDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  deviceModelCompatibility!: string[];
}
