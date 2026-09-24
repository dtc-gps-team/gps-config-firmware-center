import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** เครื่องสมาชิกหนึ่งตัวของกลุ่ม — คู่กับ `model CampaignTarget` (เก็บแค่
 * deviceId) — mirror `CreateCampaignTargetDto` เดิมทุกประการ (ดู comment
 * เหนือ `model CampaignTarget` ใน schema.prisma ว่าทำไมไม่มี `assignedTo`) */
export class CreateCampaignTargetDto {
  /** `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ `Device.id` UUID ภายใน — mirror
   * ทุก endpoint อื่นที่อ้างอุปกรณ์ (`applyConfigToDevice`, `Task.deviceId`) */
  @IsString()
  @MinLength(1)
  deviceId!: string;
}

/**
 * Body ของ `POST /campaigns` — สร้าง "กลุ่มอุปกรณ์" เปล่าๆ เท่านั้น (แก้ไข
 * 2026-09-24 — เดิม DTO นี้รับ payloadType/configId/firmwareId มาสร้าง+ส่ง
 * อนุมัติพร้อมกันในคำขอเดียว ย้าย field พวกนั้นไปอยู่ที่
 * `dto/create-campaign-rollout.dto.ts` แทน เพราะกลุ่มหนึ่งใช้ push payload ได้
 * หลายรอบ ไม่ผูกกับ payload ตัวเดียวอีกต่อไป — ดู comment เหนือ `model
 * Campaign` ใน schema.prisma)
 *
 * **MVP (มติ 2026-09-24):** สมาชิกกลุ่ม fix ตอนสร้างเท่านั้น ยังไม่มี endpoint
 * เพิ่ม/ลบสมาชิกทีหลัง — เป็นงานถัดไป
 */
export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCampaignTargetDto)
  targets!: CreateCampaignTargetDto[];
}
