import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** แก้ได้เฉพาะ Config ที่ยังเป็นสถานะ draft (เช็คที่ ConfigService.update) */
export class UpdateConfigDto {
  // เปลี่ยนชื่อได้ตอนยัง draft — ยังคง unique ทั้งระบบ ชนกัน -> 409
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

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
