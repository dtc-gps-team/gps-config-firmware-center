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
}
