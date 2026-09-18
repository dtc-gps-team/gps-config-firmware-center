import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Body ของ `PATCH /users/{id}` (User / Role Management — Admin เท่านั้น) —
 * แก้ role และ/หรือเปิด-ปิดการใช้งานบัญชี (ไม่มี hard delete — `isActive:
 * false` แทน) ทั้งสอง field optional ส่งมาแค่ตัวที่จะแก้ก็พอ (global
 * ValidationPipe เป็น whitelist อยู่แล้ว)
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
