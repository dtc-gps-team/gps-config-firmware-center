import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * เลขประจำตัวฮาร์ดแวร์ของอุปกรณ์ที่ห้ามซ้ำกับเครื่องอื่น (มติ A 2026-11-05): IMEI, Serial Number, Blackbox ID
 * — ห้ามซ้ำ "ตลอดกาล" รวมเครื่องที่ปลดระวางแล้วด้วย (เครื่องเดิมที่กลับมาใช้ควรเปิดใช้งานกลับที่เรคคอร์ดเดิม
 * ให้ประวัติต่อเนื่อง ไม่ใช่ลงทะเบียนใหม่เป็นเครื่องที่สอง) ต่างจาก SIM ที่ซิมถอดไปใส่เครื่องอื่นได้จริง
 * จึงนับเฉพาะเครื่อง active (unique index `Device_simNumber_active_key` เดิม)
 *
 * เทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย · เครื่องเดิมที่ค่าเป็น null/ว่างไม่นับว่าซ้ำ
 * (คอลัมน์ยัง nullable ตามกฎ Migration Safety)
 *
 * ตรวจที่ชั้น service ก่อน ยังไม่ใส่ unique index จริงในฐานข้อมูล: (1) Prisma schema ประกาศ expression/
 * partial index ไม่ได้ (เกิด drift ใน `migrate diff`) (2) DB ของทีม/เครื่องอื่นอาจมีค่าซ้ำเดิมอยู่ ใส่ index
 * แล้ว migration พัง (ห้าม force ตาม CLAUDE.md) — ใช้ advisory lock ให้การลงทะเบียนต่อคิวกันแทน
 */

/** ล็อกระดับ transaction ให้การตรวจ+เพิ่มเลขประจำตัวต่อคิวกัน เรียกก่อน `assertDeviceIdentifiersFree()` */
export async function lockDeviceIdentifiers(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('Device.identifiers'))`;
}

export interface DeviceIdentifiers {
  imei?: string | null;
  serialNumber?: string | null;
  blackboxId?: string | null;
}

const FIELDS = [
  // label ขึ้นต้นข้อความ error ตรงๆ — หน้าเว็บใช้ prefix นี้ชี้ช่องที่ซ้ำ
  { key: 'imei', column: 'imei', label: 'IMEI' },
  { key: 'serialNumber', column: 'serialNumber', label: 'Serial Number' },
  { key: 'blackboxId', column: 'blackboxId', label: 'Blackbox ID' },
] as const;

/**
 * ตรวจว่าเลขประจำตัวที่ส่งมาไม่ซ้ำกับเครื่องอื่น → ซ้ำ 409 บอกว่าช่องไหนซ้ำกับเครื่องไหน
 *
 * `exceptDeviceId` — ไม่นับเครื่องนี้ (ใช้ตอนแก้ไขเครื่องตัวเองในอนาคต · และตอนลงทะเบียน `deviceId` ที่มีอยู่
 * แล้ว ปล่อยให้ P2002 ของ deviceId ตอบข้อความ "มี deviceId อยู่แล้ว" ที่ตรงจุดกว่า)
 * ต้องเรียกหลัง `lockDeviceIdentifiers()` ใน transaction เดียวกับการเขียน ไม่งั้นสองคำขอพร้อมกันเห็น "ว่าง" ทั้งคู่
 */
export async function assertDeviceIdentifiersFree(
  tx: Prisma.TransactionClient,
  ids: DeviceIdentifiers,
  exceptDeviceId?: string,
): Promise<void> {
  for (const field of FIELDS) {
    const value = ids[field.key]?.trim();
    if (!value) continue;
    const rows = await tx.$queryRaw<{ deviceId: string; status: string }[]>`
      SELECT "deviceId", status::text AS status FROM "Device"
      WHERE ${Prisma.raw(`"${field.column}"`)} IS NOT NULL
        AND lower(btrim(${Prisma.raw(`"${field.column}"`)})) = lower(btrim(${value}))
        AND "deviceId" <> ${exceptDeviceId ?? ''}
      LIMIT 1`;
    if (rows.length > 0) {
      const { deviceId, status } = rows[0];
      const retired = status === 'decommissioned' ? ' (ปลดระวางแล้ว)' : '';
      throw new ConflictException(
        `${field.label} "${value}" ซ้ำกับอุปกรณ์ ${deviceId}${retired} - ${FIELDS.map((f) => f.label).join(', ')} ห้ามซ้ำกับเครื่องอื่น`,
      );
    }
  }
}
