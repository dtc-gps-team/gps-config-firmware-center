import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { DeviceModelStatus } from '@prisma/client';

/**
 * Body ของ `PATCH /device-models/{id}` — ทุก field optional ส่งมาแค่ตัวที่จะ
 * แก้ก็พอ (global ValidationPipe whitelist อยู่แล้ว) — ไม่มี `name` ให้แก้
 * (ต้องตรงกับ string เดิมที่กระจายอยู่ทั่วระบบเป๊ะ เปลี่ยนชื่อรุ่นทีหลัง
 * เสี่ยงทำให้ Device/Config ที่อ้างชื่อเดิมหาไม่เจอ — ถ้าต้องเปลี่ยนจริง
 * ให้สร้างรุ่นใหม่แทน)
 */
export class UpdateDeviceModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  manufacturer?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  supportedProtocols?: string[];

  @IsOptional()
  @IsEnum(DeviceModelStatus)
  status?: DeviceModelStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @IsOptional()
  @IsDateString()
  endOfSupportDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
