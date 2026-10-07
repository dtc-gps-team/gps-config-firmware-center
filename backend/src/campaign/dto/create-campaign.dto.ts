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

  /** `Incident.id` ของ field report ที่ Operation "promote" มาเป็น Campaign
   * นี้ (issue #236) — optional, ส่งมาเฉพาะตอนสร้างจาก flow promote เท่านั้น
   * validate ว่า incident นั้นมีจริง + `status: investigating` (แปลว่าเพิ่ง
   * ถูก decide ด้วย outcome `promote`) + ยังไม่เคยผูกกับ Campaign อื่นมาก่อน
   * (`Campaign.sourceIncidentId` เป็น `@unique` — P2002 เป็น backstop กัน
   * race condition) — ไม่บังคับว่าต้องส่ง deviceId ของ incident นั้นเข้า
   * `targets` ด้วย (Operation อาจเลือกกลุ่มอุปกรณ์กว้างกว่าแค่เครื่องเดียว
   * ที่รายงานปัญหาก็ได้ เป็นดุลยพินิจของ Operation) */
  @IsOptional()
  @IsString()
  sourceIncidentId?: string;
}
