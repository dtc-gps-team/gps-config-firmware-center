import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * ล็อกแถว `Customer` เพื่อให้ "ลบ/ปิดใช้งานลูกค้า" ไม่ชนกับการผูกลูกค้าเข้ากับอุปกรณ์ใหม่
 * (แพทเทิร์นเดียวกับ `config-lock.ts` — TOCTOU: ตรวจว่าไม่มีเครื่องผูกแล้วค่อยลบ ระหว่างนั้น
 * อาจมีเครื่องใหม่ผูกเข้ามา แล้ว FK `onDelete: SetNull` จะปลดลูกค้าออกจากเครื่องนั้นเงียบๆ)
 *
 * - ผู้ผูก (ลงทะเบียนอุปกรณ์) เรียก `lockCustomerForReference()` ใน transaction เดียวกับการ insert
 * - ผู้ลบ/ปิดใช้งานเรียก `lockCustomerForWrite()` แล้วตรวจ "มีเครื่องผูกไหม" ซ้ำหลังได้ล็อก
 *   Postgres จึงบังคับให้สองฝั่งต่อคิวกัน
 */

/** ฝั่งผูกลูกค้ากับเครื่อง - ล็อกร่วม (FOR SHARE) หลายคนผูกพร้อมกันได้ แต่รอผู้ลบ/ปิดใช้งาน */
export async function lockCustomerForReference(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ isActive: boolean }[]>`
    SELECT "isActive" FROM "Customer" WHERE id = ${customerId} FOR SHARE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Customer id ${customerId}`);
  }
  if (!rows[0].isActive) {
    throw new ConflictException(
      'ลูกค้านี้ปิดใช้งานอยู่ ลงทะเบียนอุปกรณ์ใหม่ภายใต้ลูกค้านี้ไม่ได้ - เปิดใช้งานลูกค้าก่อน หรือเลือกลูกค้าอื่น',
    );
  }
}

/** ฝั่งลบ/แก้/ปิดใช้งาน - ล็อกเฉพาะตัว (FOR UPDATE) ต้องรอผู้ผูกที่ถือล็อกร่วมอยู่ให้จบก่อน */
export async function lockCustomerForWrite(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new NotFoundException(`ไม่พบ Customer id ${customerId}`);
  }
}

/**
 * ล็อกระดับ transaction สำหรับตรวจ "ชื่อบริษัทซ้ำ" (ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย)
 * — unique index เดิมของ `companyName` เทียบตรงตัวอักษร จึงกัน "ABC" กับ "abc" พร้อมกันไม่ได้
 * ไม่เพิ่ม expression index เพราะ Prisma schema ประกาศไม่ได้ (เกิด drift ใน `migrate diff`)
 * ใช้ advisory lock ให้การสร้าง/เปลี่ยนชื่อต่อคิวกันแทน · จำนวนลูกค้าน้อย ไม่มีผลต่อประสิทธิภาพ
 */
export async function lockCustomerNames(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('Customer.companyName'))`;
}
