import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CONFIG_DATA_TYPES } from '../config-data-types';
import { ConfigDefinitionModelSupportDto } from './create-config-definition.dto';

/**
 * Body ของ `PATCH /config-definitions/{id}` - แก้ field ที่ส่งมาเท่านั้น (ที่ไม่ส่ง = คงเดิม)
 *
 * **ไม่มี `fieldName`** โดยตั้งใจ: Config ทุกตัวเก็บค่าแยกตามชื่อ field การเปลี่ยนชื่อจะทำให้
 * Config เดิมหาค่าไม่เจอ (ขอเปลี่ยนชื่อ = ลบแล้วสร้างใหม่) · ValidationPipe
 * `forbidNonWhitelisted` จึงตอบ 400 ถ้าส่ง `fieldName` มา
 *
 * ฟิลด์ที่ validate Config (`dataType`/`allowedValues`/`required`/`minValue`/`maxValue`/
 * `supportedModels`) แก้ได้ แต่มีผลกับ Config ที่สร้างหรือแก้ **ครั้งถัดไป** เท่านั้น ไม่แก้ย้อนหลัง
 * `minValue`/`maxValue`/`defaultValue`/`unit`/`category`/`description` ส่ง `null` เพื่อล้างค่าได้
 */
export class UpdateConfigDefinitionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @IsIn(CONFIG_DATA_TYPES)
  dataType?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedValues?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  unknownSpec?: boolean;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @IsOptional()
  @IsBoolean()
  stOverridable?: boolean;

  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string | null;

  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;

  @IsOptional()
  @IsBoolean()
  restartRequired?: boolean;

  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  minValue?: number | null;

  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  maxValue?: number | null;

  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultValue?: string | null;

  /** ส่งมา = แทนที่ชุดรุ่น/โปรโตคอลทั้งชุด (ไม่ merge) · ต้องมีอย่างน้อย 1 คู่
   * **เว้นแต่** ค่าหลังแก้ (ที่ส่งมาหรือของเดิม) ของ `appliesToAllModels` เป็น
   * `true` — เช็คคู่กับ `appliesToAllModels` ที่ service เพราะเป็น
   * cross-field validation ที่ต้องรู้ค่าเดิมในกรณีไม่ได้ส่งมาทั้งคู่ด้วย
   * (เหมือนแพทเทิร์น `assertValidRange()` ของ dataType/minValue/maxValue) */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigDefinitionModelSupportDto)
  supportedModels?: ConfigDefinitionModelSupportDto[];

  /** `true` = field นี้ใช้ได้กับทุกรุ่นอุปกรณ์ (ฟีดแบ็ก 2026-11-04) */
  @IsOptional()
  @IsBoolean()
  appliesToAllModels?: boolean;
}
