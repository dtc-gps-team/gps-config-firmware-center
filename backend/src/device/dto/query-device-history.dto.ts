import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { DEVICE_HISTORY_TYPES } from '../device-history.types';

/** รูปแบบ cursor: `<ISO เวลา>_<id ของรายการ>` (ดู `DeviceHistoryService`) */
export const DEVICE_HISTORY_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z_[A-Za-z0-9:_-]+$/;

/**
 * Query ของ `GET /devices/{deviceId}/history` — แบ่งหน้าแบบ cursor (เหตุการณ์ใหม่เข้ามา
 * ได้ระหว่างที่ผู้ใช้เลื่อนดู จึงไม่ใช้ offset) · `types` กรองชนิดรายการ (คั่นด้วย
 * จุลภาค) ไม่ส่ง = ทุกชนิด
 */
export class QueryDeviceHistoryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(DEVICE_HISTORY_CURSOR_PATTERN, {
    message: 'before ต้องเป็น cursor ที่ได้จาก nextCursor ของหน้าก่อนหน้า',
  })
  before?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v !== '')
      : value,
  )
  @IsArray()
  @IsIn(DEVICE_HISTORY_TYPES, { each: true })
  types?: string[];
}
