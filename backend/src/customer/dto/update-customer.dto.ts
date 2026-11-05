import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** ช่องที่ไม่บังคับ: ว่าง/ช่องว่างล้วน = ล้างค่า (null) */
const trimToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * Body ของ `PATCH /customers/{id}` (Admin/SuperAdmin) — แก้เฉพาะ field ที่ส่งมา (ที่ไม่ส่ง = คงเดิม) ·
 * แก้ชื่อบริษัทได้ (ห้ามซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ — เครื่องผูกด้วย id จึงตามชื่อใหม่เอง) ·
 * ช่องที่ไม่บังคับส่ง `null` หรือค่าว่างเพื่อล้างค่า · `isActive` ปิด/เปิดใช้งาน
 */
export class UpdateCustomerDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'companyName ต้องไม่เป็นช่องว่างล้วน' })
  companyName?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  contactName?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsEmail({}, { message: 'email รูปแบบไม่ถูกต้อง' })
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  priorityTier?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
