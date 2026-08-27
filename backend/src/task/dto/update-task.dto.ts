import { TaskStatus } from '@prisma/client';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { TASK_STATUSES } from '../task-status';

/**
 * Partial update — ส่งมาเฉพาะ field ที่ต้องการแก้
 * field ที่เป็น nullable (description, deviceId, dueDate) ส่ง null เพื่อล้างค่าได้
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

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;
}
