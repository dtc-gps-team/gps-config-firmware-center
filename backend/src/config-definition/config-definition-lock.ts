import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ล็อกแถว `ConfigFieldDefinition` เพื่อให้ "ลบ field" ไม่ชนกับการสร้าง/แก้ Config ที่ใช้ field นั้น
 * (แนวทางเดียวกับ config-lock.ts / firmware-lock.ts):
 * - ฝั่งสร้าง/แก้ Config: `lockFieldsForUse()` (FOR SHARE) ใน transaction เดียวกับการเขียน -
 *   ถ้า field ใดถูกลบไปแล้ว -> 409 ไม่ให้เขียน Config ที่อ้าง field ที่ไม่มีนิยาม
 * - ฝั่งลบ: `lockFieldForDelete()` (FOR UPDATE) แล้วตรวจ "มี Config ใช้อยู่ไหม" ซ้ำหลังได้ล็อก
 */

export async function lockFieldsForUse(
  tx: Prisma.TransactionClient,
  fieldNames: string[],
): Promise<void> {
  if (fieldNames.length === 0) return;
  const rows = await tx.$queryRaw<{ fieldName: string }[]>`
    SELECT "fieldName" FROM "ConfigFieldDefinition"
    WHERE "fieldName" = ANY(${fieldNames}::text[]) FOR SHARE`;
  if (rows.length < new Set(fieldNames).size) {
    const found = new Set(rows.map((r) => r.fieldName));
    const missing = fieldNames.filter((n) => !found.has(n));
    throw new ConflictException(
      `พารามิเตอร์ถูกลบออกจากคลังไปแล้ว: ${[...new Set(missing)].join(', ')} - ตรวจรายการแล้วลองใหม่`,
    );
  }
}

export async function lockFieldForDelete(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "ConfigFieldDefinition" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบพารามิเตอร์ id ${id}`);
  }
}
