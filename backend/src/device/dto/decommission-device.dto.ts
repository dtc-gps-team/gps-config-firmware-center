import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body ของ `POST /devices/{deviceId}/decommission` (Admin/SuperAdmin, resource `device-registration` Update) —
 * มติ A 2026-11-05: ปลดระวางเป็นทางหลักแทนการลบ (ประวัติทั้งหมดอยู่ต่อ) · **เหตุผลบังคับกรอก** เก็บลง
 * `Device.decommissionReason` และ AuditLog
 */
export class DecommissionDeviceDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason ต้องไม่เป็นช่องว่างล้วน' })
  reason!: string;
}

/**
 * Body ของ `POST /devices/{deviceId}/reactivate` — เปิดใช้เครื่องที่ปลดระวางกลับ (กลับเป็น `registered`
 * ออก API key ใหม่แสดงครั้งเดียว) · SIM ของเครื่องเดิมอาจถูกเครื่องอื่นที่ใช้งานอยู่ใช้ไปแล้ว (SIM ห้ามซ้ำ
 * เฉพาะเครื่องที่ใช้งานอยู่) จึงส่ง `simNumber` ใหม่มาด้วยได้ ไม่ส่ง = ใช้ SIM เดิม
 */
export class ReactivateDeviceDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/\S/, { message: 'simNumber ต้องไม่เป็นช่องว่างล้วน' })
  simNumber?: string;
}
