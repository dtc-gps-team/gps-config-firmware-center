import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

/**
 * customer module — `GET /customers` (list ย่อ สำหรับ dropdown — docs/12_CustomerScope_Proposal.md เฟส B,
 * PR #127) + จัดการลูกค้า (มติ A 2026-11-05): `GET /customers/managed`, `POST`, `PATCH /{id}`
 * (แก้/ปิด-เปิดใช้งาน), `DELETE /{id}` (ลบจริงเฉพาะที่ไม่มีเครื่องผูก) — Admin/SuperAdmin เท่านั้น
 * (resource `customer`) · การลงทะเบียนอุปกรณ์ผูกลูกค้าผ่าน `customer-lock.ts` กัน race กับการลบ/ปิดใช้งาน
 *
 * AuthModule — JwtAuthGuard / JwtModule ร่วม · PrismaModule เป็น @Global
 */
@Module({
  imports: [AuthModule],
  controllers: [CustomerController],
  providers: [CustomerService],
})
export class CustomerModule {}
