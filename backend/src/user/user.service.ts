import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryUserDto } from './dto/query-user.dto';

/** ข้อมูล user แบบย่อ — id + ชื่อ + role code เท่านั้น (ไม่มี username/email/สิทธิ์) */
export interface UserSummary {
  id: string;
  fullName: string;
  role: string;
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * รายชื่อ user แบบย่อ สำหรับ dropdown "เจาะจงผู้อนุมัติ" ใน Approval Center
   * (Sprint 3 #19) · เฉพาะ user ที่ `isActive` · เรียงตามชื่อ · `role` ที่ไม่มี
   * อยู่จริง → คืน list ว่าง
   *
   * **ไม่ใช่ User / Role Management** (RBAC_Matrix.md §2 = Admin เท่านั้น —
   * จอสร้าง/แก้/ปิดบัญชี, docs/11 Part B2 ยังไม่ทำ) · endpoint นี้คืนแค่ชื่อให้
   * ทุก role ที่ login เรียกได้ (JwtAuthGuard อย่างเดียว)
   */
  async list(query: QueryUserDto): Promise<UserSummary[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: query.role ? { code: query.role } : undefined,
      },
      select: { id: true, fullName: true, role: { select: { code: true } } },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role.code,
    }));
  }
}
