import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MinLength(1)
  assignedTo!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
