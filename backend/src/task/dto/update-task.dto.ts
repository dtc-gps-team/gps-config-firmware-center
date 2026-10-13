import { TaskStatus } from '@prisma/client';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { TASK_STATUSES } from '../task-status';

/**
 * Partial update — ส่งมาเฉพาะ field ที่ต้องการแก้
 * field ที่เป็น nullable (description, deviceId, configId, dueDate) ส่ง null เพื่อล้างค่าได้
 */
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  assignedTo?: string;

  @IsOptional()
  @IsString()
  deviceId?: string | null;

  /** ส่ง null เพื่อล้าง Config ที่ผูกกับงาน — Operation เท่านั้น (ST/OT แก้ไม่ได้) */
  @IsOptional()
  @IsUUID()
  configId?: string | null;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  /**
   * เวลาที่ผู้ใช้เปลี่ยนสถานะจริง (Task Event History, issue #296) — ใช้เป็น
   * `TaskEvent.changedAt` ของ event ที่ PATCH นี้สร้าง ไม่ใช่ field ของ Task
   * เอง · Mobile ส่งเวลาที่ช่างกดตอนเข้าคิว offline มาด้วย ไม่งั้นเวลาใน
   * timeline จะเป็นเวลาที่ sync ขึ้นแทน · ไม่ส่ง = เวลา server · ส่งได้เฉพาะคู่กับ
   * `status` (ไม่งั้น 400) · เวลาในอนาคตถูกปัดลงเป็นเวลา server (ดู
   * `TaskService.resolveChangedAt`)
   */
  @IsOptional()
  @IsISO8601()
  changedAt?: string;
}
