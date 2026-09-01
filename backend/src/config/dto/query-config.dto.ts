import { ConfigStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { CONFIG_STATUSES } from '../config-status';

export class QueryConfigDto {
  @IsOptional()
  @IsIn(CONFIG_STATUSES)
  status?: ConfigStatus;
}
