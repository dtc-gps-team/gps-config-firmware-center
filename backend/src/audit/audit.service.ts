import { Injectable } from '@nestjs/common';
import { AuditLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

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

  findAll(query: QueryAuditLogDto): Promise<AuditLog[]> {
    const { userId, auditModule, action } = query;
    return this.prisma.auditLog.findMany({
      where: {
        userId: userId || undefined,
        auditModule: auditModule || undefined,
        action: action || undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
