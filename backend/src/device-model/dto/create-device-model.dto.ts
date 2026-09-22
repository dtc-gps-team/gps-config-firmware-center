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
  MinLength,
} from 'class-validator';
import { DeviceModelStatus } from '@prisma/client';

/**
 * Body ของ `POST /device-models` (issue #209, docs/15) — Admin/SuperAdmin
 * เท่านั้น (master/reference data ที่เพิ่มไม่บ่อย mirror pattern เดียวกับ
 * user-management ไม่ใช่ self-service แบบ config-definition)
 */
export class CreateDeviceModelDto {
  /** ต้องตรงกับ string เดิมที่ใช้อยู่แล้วทุกจุดเป๊ะ (เช่น "GT06N") — ไม่
   * unique ที่ DB คุมไว้อีกชั้น */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  manufacturer?: string;

  /** บังคับอย่างน้อย 1 ค่า — กันสร้างรุ่นที่ไม่มี protocol เลยจนสร้าง Config
   * ไม่ได้ถาวร (issue #209 ข้อ 4 — enforce จริงตอนสร้าง Config ด้วย) */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  supportedProtocols!: string[];

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
