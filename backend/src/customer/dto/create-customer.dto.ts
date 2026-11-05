import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** ช่องที่ไม่บังคับ: ว่าง/ช่องว่างล้วน = ไม่กรอก (undefined) */
const trimOptional = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

/**
 * Body ของ `POST /customers` (Admin/SuperAdmin) — มติ A 2026-11-05: เพิ่มลูกค้าได้จากฟอร์มลงทะเบียน
 * อุปกรณ์ · `companyName` บังคับ (ห้ามซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ — เช็คที่ service) ที่เหลือไม่บังคับ
 * ทุกช่องตัดช่องว่างหัวท้ายก่อนตรวจ
 */
export class CreateCustomerDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'companyName ต้องไม่เป็นช่องว่างล้วน' })
  companyName!: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsEmail({}, { message: 'email รูปแบบไม่ถูกต้อง' })
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  phone?: string;

  /** เก็บเป็น string เฉยๆ (ยังไม่ยืนยันค่าจริงจากพี่เลี้ยง — ดูคอมเมนต์เหนือ model Customer) */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  priorityTier?: string;
}
