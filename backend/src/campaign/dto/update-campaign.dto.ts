import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateCampaignTargetDto } from './create-campaign.dto';

/**
 * Body ของ `PATCH /campaigns/{id}` — แก้ชื่อ/คำอธิบายกลุ่ม ส่งมาอย่างน้อย 1 field
 * (ว่างทั้งคู่ = 400 ที่ service) · `description` ส่งสตริงว่างเพื่อล้างคำอธิบายได้
 */
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
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
