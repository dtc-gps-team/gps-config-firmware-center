import { Injectable } from '@nestjs/common';
import { ConfigFieldDefinition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Config Definition Lookup (task #12, แผน Agile แถว 12) — catalog ของ field ที่
 * ระบบรู้จัก (ชื่อ, ชนิดข้อมูล, ค่าที่ยอมรับ, บังคับกรอกไหม)
 *
 * รอบนี้ทำแค่ **อ่านอย่างเดียว** — ยังไม่ผูกกับ `ConfigService`/`DeviceSimulator`
 * (การเอา catalog นี้ไป validate `fields` ของ Config ตอน import/simulate เป็นงาน
 * ถัดไป ต้องออกแบบเพิ่มว่าจะ query/validate ต่อ deviceModel/protocol ยังไง —
 * ดู `// TODO(รอตาราง ConfigFieldDefinition)` ใน `config.service.ts` และ Gap
 * เรื่องตาราง join `CONFIG_DEFINITION_MODEL_SUPPORT` ใน RBAC_Matrix.md Section 6)
 */
@Injectable()
export class ConfigDefinitionService {
  constructor(private readonly prisma: PrismaService) {}

  /** คืน field definition ทั้งหมด เรียงตาม `fieldName` — ไม่มี paging/filter
   * เพราะ catalog มีขนาดเล็ก (หลัก ~สิบ–ร้อย field) และ client ฝั่ง Web/Mobile
   * โหลดครั้งเดียวไปแคชไว้ใช้ตอนกรอกฟอร์ม Config */
  findAll(): Promise<ConfigFieldDefinition[]> {
    return this.prisma.configFieldDefinition.findMany({
      orderBy: { fieldName: 'asc' },
    });
  }
}
