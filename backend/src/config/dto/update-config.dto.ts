import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

/** แก้ได้เฉพาะ Config ที่ยังเป็นสถานะ draft (เช็คที่ ConfigService.update) */
export class UpdateConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  protocol?: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}
