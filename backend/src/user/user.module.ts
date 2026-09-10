import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * user module — รอบนี้มีแค่ `GET /users` (list ย่อ id+ชื่อ+role สำหรับ dropdown
 * "เจาะจงผู้อนุมัติ" ใน Approval Center — Sprint 3 #19)
 *
 * จอ User / Role Management เต็ม (สร้าง/แก้/ปิดบัญชี, จัดการ role — Admin
 * เท่านั้น ตาม RBAC_Matrix.md §2) = docs/11 Part B2 ยังไม่ทำ · จะมาต่อยอด
 * module นี้ตอนนั้น
 *
 * AuthModule — JwtAuthGuard / JwtModule ร่วม · PrismaModule เป็น @Global
 */
@Module({
  imports: [AuthModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
