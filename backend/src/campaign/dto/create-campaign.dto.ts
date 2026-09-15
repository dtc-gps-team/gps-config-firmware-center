import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CampaignPayloadType } from '@prisma/client';

/** เครื่องเป้าหมายหนึ่งตัวของแคมเปญ — คู่กับ `model CampaignTarget` (เก็บแค่
 * deviceId)
 *
 * **แก้ไข 2026-09-14:** เดิม DTO นี้มี field `assignedTo` (user id ของช่าง
 * หน้างานที่รับผิดชอบเครื่องนี้) เพื่อสร้าง Task ต่อเครื่องพร้อมมอบหมายงาน
 * ตอน submit — หัวหน้าแก้ scope ว่า Campaign มีไว้สำหรับติดตาม/บำรุงรักษา
 * อุปกรณ์เป็นกลุ่มเท่านั้น (อัปเดต Config/Firmware + สังเกตความผิดปกติ)
 * **ไม่ใช่มอบหมายงานให้ช่างหน้างาน** เพราะการมอบหมายงานเป็นหน้าที่ของระบบ
 * แยกที่บริษัทมีอยู่แล้ว — ทำเองจะซ้อนทับระบบ จึงตัด `assignedTo` และการสร้าง
 * Task ออกจาก Campaign ทั้งหมด (ดู RBAC_Matrix.md changelog) */
export class CreateCampaignTargetDto {
  /** `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ `Device.id` UUID ภายใน — mirror
   * ทุก endpoint อื่นที่อ้างอุปกรณ์ (`applyConfigToDevice`, `Task.deviceId`) */
  @IsString()
  @MinLength(1)
  deviceId!: string;
}

/**
 * Body ของ `POST /campaigns` (Campaign Wizard #21) — Operation เท่านั้น
 * (RBAC_Matrix.md §2 แถว "Campaign Wizard" คอลัมน์ Operation = C, R, U)
 *
 * รวม 3 ขั้นแรกของ wizard (เลือกเป้าหมาย / เลือก Payload / ตรวจสอบ&ยืนยัน)
 * เป็น request เดียว — ขั้น "กำหนดกลยุทธ์ Rollout" ไม่มี field ในนี้เพราะ v1
 * ตัด rollout strategy ออกหมด (canary/batch/auto-pause) เหลือ "ส่งพร้อมกันหมด"
 * ค่าเดียว ไม่ต้องรับ input อะไรเพิ่ม (ดู comment เหนือ `model Campaign` ใน
 * schema.prisma)
 *
 * **แก้ไข 2026-09-14: เปิดรับ `payloadType: Firmware` แล้ว** — ตอนที่เขียน DTO
 * นี้ครั้งแรก (Sprint 3 #21) ยังไม่มี backend `firmware` module เลย จึง block
 * ไว้ก่อน ตอนนี้ Sprint 3 #23 (PR #151) implement เสร็จแล้ว จึงเพิ่ม field
 * `firmwareId` เข้ามาคู่กับ `configId` — บังคับให้ระบุอย่างใดอย่างหนึ่งตาม
 * `payloadType` (validate ใน service อีกชั้นด้วย defensive)
 */
export class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(CampaignPayloadType)
  payloadType!: CampaignPayloadType;

  /** บังคับเฉพาะตอน payloadType=Config */
  @ValidateIf((dto: CreateCampaignDto) => dto.payloadType === 'Config')
  @IsUUID()
  configId?: string;

  /** บังคับเฉพาะตอน payloadType=Firmware */
  @ValidateIf((dto: CreateCampaignDto) => dto.payloadType === 'Firmware')
  @IsUUID()
  firmwareId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCampaignTargetDto)
  targets!: CreateCampaignTargetDto[];
}
