import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ข้อมูลลูกค้าแบบย่อ — id + ชื่อบริษัทเท่านั้น (ไม่มี contactName/email/phone/
 * priorityTier) ใช้ pattern เดียวกับ `UserSummary` ใน `user/user.service.ts`:
 * endpoint นี้ให้ทุก role ที่ login แล้วเรียกได้ (dropdown filter บน Device
 * Search) จึงไม่ควรคืนข้อมูลติดต่อของลูกค้าที่ละเอียดกว่าที่จำเป็น
 */
export interface CustomerSummary {
  id: string;
  companyName: string;
}

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * รายชื่อลูกค้าทั้งหมด เรียงตามชื่อบริษัท — ใช้เป็น dropdown filter บนหน้า
   * Device Search (docs/12_CustomerScope_Proposal.md เฟส B, PR #127) ยังไม่มี
   * paging เพราะจำนวนลูกค้าใน MVP น้อย (mirror `UserService.list`)
   *
   * **ไม่ใช่หน้า "จัดการลูกค้า"** (Admin CRUD สร้าง/แก้/ลบ) — ตัดสินใจร่วมกัน
   * ว่าเกินขอบเขตตอนนี้ ลูกค้าเพิ่มได้ผ่าน seed เท่านั้น (ดู
   * RBAC_Matrix.md changelog แก้ครั้งที่ 29)
   */
  async findAll(): Promise<CustomerSummary[]> {
    return this.prisma.customer.findMany({
      select: { id: true, companyName: true },
      orderBy: { companyName: 'asc' },
    });
  }
}
