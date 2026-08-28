import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class QueryNotificationDto {
  /**
   * กรองเฉพาะ notification ที่ยังไม่ได้อ่าน (read=false)
   * รับค่าเป็น string "true"/"false" จาก query string แล้ว transform เป็น boolean
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  unread?: boolean;
}
