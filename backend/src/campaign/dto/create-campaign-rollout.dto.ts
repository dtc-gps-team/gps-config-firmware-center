import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CampaignPayloadType } from '@prisma/client';
import {
  MAX_APPLY_TIMEOUT_MINUTES,
  MAX_PULL_TIMEOUT_HOURS,
} from '../campaign-rollout-status';

/** จำนวนเครื่องที่มีค่าเฉพาะเครื่องได้ต่อ Rollout (docs/17 ข้อ 5) */
export const MAX_DEVICE_VALUES_PER_ROLLOUT = 200;

/** ค่าเฉพาะเครื่อง 1 เครื่อง — `fields` คือค่าสุดท้ายที่เลือกแล้ว (รวมค่า
 * พิเศษเดิมที่ผู้ใช้ยืนยันให้ใช้ต่อ) backend ไม่เติมค่าให้เอง */
export class RolloutDeviceValueDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsObject()
  fields!: Record<string, unknown>;
}

/**
 * Body ของ `POST /campaigns/{id}/rollouts` — เลือก Config หรือ Firmware มา
 * push เข้ากลุ่มอุปกรณ์ (แก้ไข 2026-09-24 — เดิม field พวกนี้อยู่ใน
 * `CreateCampaignDto` ตรงๆ ดู comment เหนือ `model CampaignRollout` ใน
 * schema.prisma)
 *
 * **ไม่มี field เลือก target เอง** — default = สมาชิกทั้งกลุ่ม (`CampaignTarget`
 * ทั้งหมดของ Campaign นี้) มติ 2026-09-24: rollout หนึ่งรอบ push ทั้งกลุ่มเป็น
 * ค่าเริ่มต้น เอาบางเครื่องออกได้ผ่าน `excludeDeviceIds` เท่านั้น (กันกรณีบาง
 * เครื่องในกลุ่มไม่พร้อมแล้ว เช่นปลดระวางไป ไม่ให้ block ทั้ง rollout) —
 * ไม่รองรับ "เลือกเพิ่มเครื่องนอกกลุ่ม" เพราะขัดกับ concept กลุ่ม
 */
export class CreateCampaignRolloutDto {
  @IsEnum(CampaignPayloadType)
  payloadType!: CampaignPayloadType;

  /** บังคับเฉพาะตอน payloadType=Config */
  @ValidateIf((dto: CreateCampaignRolloutDto) => dto.payloadType === 'Config')
  @IsUUID()
  configId?: string;

  /** บังคับเฉพาะตอน payloadType=Firmware */
  @ValidateIf((dto: CreateCampaignRolloutDto) => dto.payloadType === 'Firmware')
  @IsUUID()
  firmwareId?: string;

  /** `Device.deviceId` ของสมาชิกกลุ่มที่ต้องการเอาออกจาก rollout รอบนี้
   * (ไม่ต้อง IsUUID เพราะ deviceId เป็นเลขเครื่องจริง ไม่ใช่ UUID ภายใน) */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  excludeDeviceIds?: string[];

  /** เครื่องไม่มาดึงงานเลยภายในกี่ชั่วโมงหลังปล่อย -> ข้าม (`skipped_offline`)
   * ใช้กับ Rollout โหมด real เท่านั้น ไม่ส่ง = ค่าเริ่มต้น 72 ชั่วโมง
   * (docs/19 §16, PDF §9.1 Execution: Timeout) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PULL_TIMEOUT_HOURS)
  pullTimeoutHours?: number;

  /** ดึงงานแล้วไม่รายงานผลภายในกี่นาที -> ล้มเหลว ไม่ส่ง = ค่าเริ่มต้น 30 นาที */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_APPLY_TIMEOUT_MINUTES)
  applyTimeoutMinutes?: number;

  /** ค่าเฉพาะเครื่องตอนเริ่ม Rollout (docs/17) — ใช้ได้เฉพาะ
   * payloadType=Config เก็บไว้ที่ target ยังไม่มีผลกับเครื่อง จนกว่า
   * Rollout จะถูกปล่อย (`release()`) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DEVICE_VALUES_PER_ROLLOUT)
  @ValidateNested({ each: true })
  @Type(() => RolloutDeviceValueDto)
  deviceValues?: RolloutDeviceValueDto[];

  /** เหตุผลของค่าเฉพาะเครื่องทั้งรอบ — บังคับเมื่อมี `deviceValues` */
  @ValidateIf(
    (dto: CreateCampaignRolloutDto) =>
      dto.deviceValues !== undefined && dto.deviceValues.length > 0,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  deviceValuesReason?: string;
}
