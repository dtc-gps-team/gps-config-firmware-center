import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** รูปแบบ cursor: `<requestedAt แบบ ISO>_<id ของคำขอ>` (ดู `historyForTask`) */
export const TASK_APPLY_HISTORY_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z_[0-9a-f-]{36}$/;

/** กลุ่มผลที่หน้าประวัติคำขอกรองได้ (v3.96) — ช่างไม่ต้องรู้สถานะย่อย 9 ค่า */
export const TASK_APPLY_HISTORY_RESULTS = [
  'succeeded',
  'unsuccessful',
  'open',
] as const;
export type TaskApplyHistoryResult =
  (typeof TASK_APPLY_HISTORY_RESULTS)[number];

export const TASK_APPLY_HISTORY_DEFAULT_LIMIT = 20;

/**
 * Query ของ `GET /tasks/{taskId}/config-apply-requests/history` — แบ่งหน้าแบบ cursor
 * (คำขอใหม่เข้ามาได้ระหว่างเลื่อนดู จึงไม่ใช้ offset) แบบเดียวกับ
 * `GET /devices/{deviceId}/history`
 */
export class QueryTaskApplyHistoryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(TASK_APPLY_HISTORY_CURSOR_PATTERN, {
    message: 'before ต้องเป็น cursor ที่ได้จาก nextCursor ของหน้าก่อนหน้า',
  })
  before?: string;

  @IsOptional()
  @IsIn(TASK_APPLY_HISTORY_RESULTS)
  result?: TaskApplyHistoryResult;

  @IsOptional()
  @IsIn(['config', 'firmware'])
  kind?: 'config' | 'firmware';
}
