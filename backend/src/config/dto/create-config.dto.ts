import { IsObject, IsString, MinLength } from 'class-validator';

export class CreateConfigDto {
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
