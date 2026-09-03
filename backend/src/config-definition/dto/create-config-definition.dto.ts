import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** รุ่นอุปกรณ์ + โปรโตคอลคู่หนึ่งที่ field นี้ใช้ได้ — field เดียวระบุได้
 * หลายคู่ (เช่น APN ใช้กับทั้ง GT06N/TCP และ GT06N/UDP) */
export class ConfigDefinitionModelSupportDto {
  @IsString()
  @MinLength(1)
  deviceModel!: string;

  @IsString()
  @MinLength(1)
  protocol!: string;
}

/** Body ของ `POST /config-definitions` — SW สร้าง field definition ใหม่เอง
 * (self-service ไม่ต้องรออนุมัติ — ตัดสินใจร่วมกับ B และพี่เลี้ยง 2569-09)
 *
 * `supportedModels` บังคับต้องมีอย่างน้อย 1 คู่เสมอ — field ที่ไม่ผูกกับรุ่น
 * ไหนเลยใช้ validate อะไรไม่ได้จริง (ConfigDefinitionService.validateFields
 * จะมองว่า field แบบนี้ "ไม่รองรับ" ทุกรุ่นเท่ากันหมด) */
export class CreateConfigDefinitionDto {
  @IsString()
  @MinLength(1)
  fieldName!: string;

  @IsString()
  @MinLength(1)
  dataType!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedValues?: string[];

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigDefinitionModelSupportDto)
  supportedModels!: ConfigDefinitionModelSupportDto[];
}
