import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * user module — `GET /users` (list ย่อ id+ชื่อ+role สำหรับ dropdown "เจาะจง
 * ผู้อนุมัติ" ใน Approval Center — Sprint 3 #19) + User / Role Management
 * (Admin เท่านั้น — `GET /users/managed`, `POST /users`, `PATCH /users/{id}`,
 * resource `user-management`) จัดการได้แค่บัญชีทั่วไป ไม่รวม Admin/SuperAdmin
 * (ดู `managed-user-roles.ts`) — การจัดการบัญชี Admin/SuperAdmin เอง
 * (`admin-management`/`role-management`) ยังไม่ finalize (docs/11) ตกลงกับ A
 * แล้วว่าพักไว้ก่อน (2026-09-18)
 *
 * AuthModule — JwtAuthGuard / JwtModule ร่วม · PrismaModule เป็น @Global
 */
@Module({
  imports: [AuthModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
