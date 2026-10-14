import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUDIT_LOG_DEFAULT_PAGE_SIZE,
  QueryAuditLogDto,
} from './dto/query-audit-log.dto';

/** response ของ `GET /audit-logs` — `AuditLogPage` ใน openapi.yaml */
export type AuditLogPage = {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * audit module (ฝั่ง A) — read-only endpoint `GET /audit-logs` (Sprint 3 #27)
 *
 * **การเขียนไม่ได้อยู่ที่นี่** — แต่ละโมดูลเขียน `prisma.auditLog.create(...)`
 * ตรงๆ ในจุดที่เกิด mutation จริง (mirror pattern เดิมของ
 * `config-deletion.service.ts`) ไม่รวมศูนย์ผ่าน writer กลางในไฟล์นี้ ตอนนี้
 * เขียนจาก `config.service.ts` (create/update/delete/decide/approve/reject)
 * และ `device.service.ts` (applyConfig) — **task/notification (โมดูลของ B)
 * ยังไม่มี AuditLog write** ต้องให้ B เพิ่มเองในโมดูลตัวเอง คนละ PR (แนวเดียว
 * กับที่ config-sync-writer ให้แต่ละคน `.on()`/`create()` ในไฟล์ของตัวเอง)
 *
 * ไม่ join ชื่อผู้ใช้ตรงนี้ — Web resolve จาก `GET /users` เอง (ไม่ระบุ role)
 * แพทเทิร์นเดียวกับที่ resolve ชื่อ `suggestedApproverId` ใน Approval Center
 * (#19)
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryAuditLogDto): Promise<AuditLogPage> {
    const {
      userId,
      auditModule,
      action,
      actorName,
      from,
      to,
      page = 1,
      pageSize = AUDIT_LOG_DEFAULT_PAGE_SIZE,
    } = query;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('from ต้องไม่มากกว่า to');
    }
    const where: Prisma.AuditLogWhereInput = {
      userId: userId || undefined,
      auditModule: auditModule || undefined,
      // action เป็นช่องค้นหา (ไม่ใช่ dropdown ค่าคงที่แบบ auditModule) —
      // ใช้ contains แบบไม่สนตัวพิมพ์เล็ก-ใหญ่ ให้พิมพ์บางส่วนของคำแล้วเจอได้เลย
      action: action ? { contains: action, mode: 'insensitive' } : undefined,
      // ค้นชื่อผ่าน relation `user` — ไม่กรอง isActive ตั้งใจ ให้สืบประวัติของ
      // บัญชีที่ปิดไปแล้วได้
      user: actorName
        ? { fullName: { contains: actorName, mode: 'insensitive' } }
        : undefined,
      createdAt:
        fromDate || toDate ? { gte: fromDate, lte: toDate } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        // id เป็นตัวตัดสินเมื่อ createdAt เท่ากัน (เช่น audit หลายแถวที่เขียนใน
        // transaction เดียวกัน) Postgres ไม่การันตีลำดับแถวที่ค่าเรียงเท่ากัน
        // ถ้าไม่มีตัวตัดสิน แถวอาจซ้ำหรือหายระหว่างหน้า (รีวิว B บน #301 ข้อ 2)
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
