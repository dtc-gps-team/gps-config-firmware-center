import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateConfigDto {
  // ชื่อ Config ที่คนตั้ง — unique ทั้งระบบ (มติ Sprint 1 review ข้อ 4) ชนกัน ->
  // 409 ที่ ConfigService.create (จับ Prisma P2002) MaxLength 120 พอสำหรับชื่อ
  // ที่อ่านรู้เรื่อง ไม่เปิดช่องยัด payload ยาว
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  deviceModel!: string;

  @IsString()
  @MinLength(1)
  protocol!: string;

  // ค่า field ตาม Config Definition Lookup (เช่น APN1, MTYP, SIM1) — ยังไม่
  // validate เทียบกับ ConfigFieldDefinition ใน Stage 1 นี้ (schema เปล่าไว้
  // ก่อน ดู backend/prisma/schema.prisma) รอ Stage ถัดไปที่ต่อ validation จริง
  @IsObject()
  fields!: Record<string, unknown>;
}
