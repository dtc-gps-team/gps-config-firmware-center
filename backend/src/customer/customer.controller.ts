import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CustomerService, CustomerSummary } from './customer.service';

// customer module (read-only — docs/12_CustomerScope_Proposal.md เฟส B):
//   GET /customers  — รายชื่อลูกค้าแบบย่อ (id + ชื่อบริษัท)
//
// JwtAuthGuard อย่างเดียว ไม่มี PermissionGuard/resource — ทุก role ที่ login
// เรียกได้ (pattern เดียวกับ `/users` และ `/notifications/device-tokens`) ·
// endpoint นี้เกิดมาเพื่อ dropdown filter "ลูกค้า" บนหน้า Device Search
// **ไม่ใช่** จอ "จัดการลูกค้า" (Admin CRUD) ที่ตัดสินใจแล้วว่าเกินขอบเขตตอนนี้
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  findAll(): Promise<CustomerSummary[]> {
    return this.customerService.findAll();
  }
}
