import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body ของ `POST /users` (User / Role Management — Admin เท่านั้น) — สร้าง
 * บัญชีใหม่ Admin เป็นคนตั้งรหัสผ่านเริ่มต้นเอง (ตกลงกับ paveekornk แล้ว —
 * ระบบยังไม่มี flow ลืมรหัสผ่าน/reset password เลย ทำ auto-generate ตอนนี้
 * จะเกินความจำเป็น) `role` ต้องไม่ใช่ Admin/SuperAdmin (เช็คที่ service —
 * ดู `managed-user-roles.ts`)
 */
export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'username ใช้ได้แค่ตัวอักษร ตัวเลข . _ - เท่านั้น',
  })
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName!: string;

  @IsString()
  @MinLength(8, { message: 'password ต้องมีอย่างน้อย 8 ตัวอักษร' })
  @MaxLength(100)
  password!: string;

  @IsString()
  role!: string;
}
