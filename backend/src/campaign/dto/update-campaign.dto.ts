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
import { CreateCampaignTargetDto } from './create-campaign.dto';

/**
 * Body ของ `PATCH /campaigns/{id}` — แก้ชื่อ/คำอธิบายกลุ่ม/สวิตช์ลองส่งใหม่ ส่งมาอย่างน้อย 1 field
 * (ว่างทั้งหมด = 400 ที่ service) · `description` ส่งสตริงว่างเพื่อล้างคำอธิบายได้ · `autoRetry` มีผลทันที
 * กับ Rollout ที่กำลังรันอยู่ (อ่านค่าสดทุกครั้งที่ตัดสิน: ปิดแล้วเครื่องที่รอรอบใหม่จบด้วยผลรอบล่าสุด)
 */
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  autoRetry?: boolean;
}

/** Body ของ `POST /campaigns/{id}/targets` — เพิ่มเครื่องเข้ากลุ่ม (กฎเดียวกับ
 * ตอนสร้างกลุ่ม: ต้องมีอยู่จริง สถานะ `installed` และไม่ซ้ำ) */
export class AddCampaignTargetsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCampaignTargetDto)
  targets!: CreateCampaignTargetDto[];
}
