import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** ช่องที่ล้างค่าได้: ว่าง/ช่องว่างล้วน = ล้างค่า (null) */
const trimToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * Body ของ `PATCH /devices/{deviceId}` (Admin/SuperAdmin, resource `device-registration` Update) — มติ A
 * 2026-11-05 · แก้เฉพาะ field ที่ส่งมา (ที่ไม่ส่ง = คงเดิม)
 *
 * **แก้ได้:** SIM, ลูกค้า, hardware revision, IMEI, Serial Number, Blackbox ID · **แก้ไม่ได้:** Device ID /
 * โมเดล / โปรโตคอล (ลงทะเบียนผิดให้ลบ-ลงใหม่เฉพาะเครื่องที่ยังไม่เคยใช้ หรือปลดระวาง) · แก้เครื่องที่
 * ปลดระวางแล้วไม่ได้ (409)
 *
 * IMEI / Serial / Blackbox ห้ามซ้ำกับเครื่องอื่นตลอดกาล (รวมที่ปลดระวางแล้ว) และ SIM ห้ามซ้ำกับเครื่อง
 * ที่ใช้งานอยู่ — ตรวจที่ service แล้ว 409 · ทั้งสี่ช่องบังคับกรอกตอนลงทะเบียนจึง **ล้างค่าไม่ได้** มีแค่
 * hardware revision (ไม่บังคับ) ที่ส่งค่าว่างเพื่อล้างได้
 */
export class UpdateDeviceDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/\S/, { message: 'simNumber ต้องไม่เป็นช่องว่างล้วน' })
  simNumber?: string;

  /** เปลี่ยนไปผูกลูกค้าอื่น (ต้องเป็นลูกค้าที่ใช้งานอยู่) — ล้างลูกค้าออกไม่ได้ */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  hardwareRevisionCode?: string | null;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/\S/, { message: 'imei ต้องไม่เป็นช่องว่างล้วน' })
  imei?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/\S/, { message: 'serialNumber ต้องไม่เป็นช่องว่างล้วน' })
  serialNumber?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/\S/, { message: 'blackboxId ต้องไม่เป็นช่องว่างล้วน' })
  blackboxId?: string;
}
