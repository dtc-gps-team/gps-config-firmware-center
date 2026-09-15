import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

/**
 * customer module — รอบนี้มีแค่ `GET /customers` (list ย่อ id+ชื่อบริษัท
 * สำหรับ dropdown filter บนหน้า Device Search — docs/12_CustomerScope_Proposal.md
 * เฟส B, PR #127)
 *
 * จอ "จัดการลูกค้า" เต็ม (สร้าง/แก้/ลบ — Admin เท่านั้น) ตัดสินใจร่วมกันแล้วว่า
 * เกินขอบเขตตอนนี้ — ลูกค้าเพิ่ม/แก้ได้ผ่าน seed เท่านั้น
 *
 * AuthModule — JwtAuthGuard / JwtModule ร่วม · PrismaModule เป็น @Global
 */
@Module({
  imports: [AuthModule],
  controllers: [CustomerController],
  providers: [CustomerService],
})
export class CustomerModule {}
