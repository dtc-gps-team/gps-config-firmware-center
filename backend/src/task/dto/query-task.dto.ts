import { TaskStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { TASK_STATUSES } from '../task-status';

export class QueryTaskDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
