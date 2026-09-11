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

/** เครื่องเป้าหมายหนึ่งตัวของแคมเปญ + คนที่ต้องไปติดตั้งหน้างาน — คู่กับ
 * `model CampaignTarget` (เก็บแค่ deviceId) และ `Task.assignedTo` (ผู้รับผิดชอบ
 * เก็บที่ Task ไม่ใช่ CampaignTarget — ดู comment เหนือ model CampaignTarget
 * ใน schema.prisma) */
export class CreateCampaignTargetDto {
  /** `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่ `Device.id` UUID ภายใน — mirror
   * ทุก endpoint อื่นที่อ้างอุปกรณ์ (`applyConfigToDevice`, `Task.deviceId`) */
  @IsString()
  @MinLength(1)
  deviceId!: string;

  /** user id ของช่างหน้างาน (ST/OT) ที่รับผิดชอบเครื่องนี้ — ไม่บังคับ role
   * ที่ระดับ validation (mirror TaskService.create ที่ไม่เช็ค role ของ
   * assignedTo เช่นกัน) แต่ service จะเช็คว่า user มีอยู่จริง+active เพราะ
   * `Task.assignedTo` มี FK ไป `User.id` จริง (ต่างจาก `CampaignTarget.deviceId`
   * ที่เป็น loose string) — insert ทีเดียวหลายแถวถ้ามี id ผิดจะเจอ FK violation
   * ที่อ่านยาก ถ้าไม่เช็คก่อน */
  @IsString()
  @MinLength(1)
  assignedTo!: string;
}

/**
 * Body ของ `POST /campaigns` (Campaign Wizard #21) — Operation เท่านั้น
 * (RBAC_Matrix.md §2 แถว "Campaign Wizard" คอลัมน์ Operation = C, R, U)
 *
 * รวม 3 ขั้นแรกของ wizard (เลือกเป้าหมาย+มอบหมาย / เลือก Payload /
 * ตรวจสอบ&ยืนยัน) เป็น request เดียว — ขั้น "กำหนดกลยุทธ์ Rollout" ไม่มี field
 * ในนี้เพราะ v1 ตัด rollout strategy ออกหมด (canary/batch/auto-pause) เหลือ
 * "ส่งพร้อมกันหมด" ค่าเดียว ไม่ต้องรับ input อะไรเพิ่ม (ดู comment เหนือ
 * `model Campaign` ใน schema.prisma)
 *
 * **`payloadType: Firmware` ยังไม่รองรับ** (service throw 400) — ตอนนี้ยังไม่มี
 * backend `firmware` module เลย ไม่มีทางสร้าง Firmware record ผ่าน API ให้เลือก
 * เลย รอ Sprint 3 #23 ก่อนค่อยเปิด (ตัดสินใจกับ paveekornk เอง 2026-09-11 —
 * ดู RBAC_Matrix.md changelog)
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

  /** บังคับเฉพาะตอน payloadType=Config (ตัวเดียวที่รองรับตอนนี้) — ไม่มี field
   * `firmwareId` ใน DTO นี้เลยโดยตั้งใจ (ไม่รับผ่าน API จนกว่าจะมี firmware
   * module จริง) */
  @ValidateIf((dto: CreateCampaignDto) => dto.payloadType === 'Config')
  @IsUUID()
  configId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCampaignTargetDto)
  targets!: CreateCampaignTargetDto[];
}
