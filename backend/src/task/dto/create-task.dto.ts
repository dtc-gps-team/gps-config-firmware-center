import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

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

  /**
   * Config ที่ผูกกับงานติดตั้ง (Mobile อ่านไปส่งเข้า apply-config) — เฉพาะ
   * Config สถานะ approved/synced เท่านั้น (เช็คใน TaskService) งานประเภทอื่น
   * ไม่ต้องส่ง
   */
  @IsOptional()
  @IsUUID()
  configId?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
