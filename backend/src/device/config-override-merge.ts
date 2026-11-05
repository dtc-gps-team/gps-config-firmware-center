import { Logger } from '@nestjs/common';
import { DeviceConfigOverride, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('ConfigOverrideMerge');

/**
 * merge แถว `DeviceConfigOverride` สถานะ `approved` ที่**ยังไม่ถูกใช้**
 * (`consumedAt: null`) ล่าสุด (`versionNumber` มากสุด) ของ (deviceId, configId)
 * ทับ base fields — ใช้ร่วมกันโดย `DeviceService`
 * (`applyConfig()`/`simulateConfig()`/`getCurrentConfig()`), `CampaignRolloutService`
 * (`autoApplyConfig()`, #235 review comment ข้อ 1), `DeviceSyncService` และ
 * `ConfigApplyRequestService` เพื่อให้ทุกจุดที่ "ใส่ Config เข้าอุปกรณ์" ได้ค่า
 * เดียวกันเสมอ (issue #223/#226) · pending/rejected ไม่มีผล · `approvedOverride`
 * เป็น `null` เมื่อไม่มีแถวที่รอส่ง (fields = base เดิม)
 *
 * **ใช้ครั้งเดียว (มติ B 2026-11-03):** ค่าที่แก้มีผลกับการส่งครั้งถัดไปครั้งเดียว
 * ส่งสำเร็จแล้วเส้นทางส่ง mark ด้วย `markOverrideConsumed()` ส่ง Config เดิมครั้ง
 * ถัดไปจึงได้ค่าต้นฉบับ · เดิม (ก่อนมตินี้) แถว approved ล่าสุดถูก merge ทุกครั้ง
 * ตลอดไป ทำให้หน้าเลือก Config ขึ้นค่าที่เคยแก้แทนค่าต้นฉบับ
 *
 * แยกเป็น pure function (ไม่ใช่ private method ของ `DeviceService`) เพราะทั้ง
 * สอง service inject แค่ `PrismaService` อยู่แล้ว — ไม่ต้อง export เป็น public
 * method แล้ว inject `DeviceService` เข้า `CampaignRolloutService` ข้าม
 * module ซึ่งจะเสี่ยง circular dependency แบบเดียวกับที่ comment เหนือ
 * `CONFIG_APPLIER`/`FIRMWARE_ROLLBACK_EXECUTOR` ใน `campaign.module.ts` เตือนไว้
 */
export async function mergeApprovedOverride(
  prisma: PrismaService,
  deviceId: string,
  configId: string,
  baseFields: Prisma.JsonValue,
): Promise<{
  fields: Record<string, unknown>;
  approvedOverride: DeviceConfigOverride | null;
}> {
  const approvedOverride = await prisma.deviceConfigOverride.findFirst({
    where: { deviceId, configId, status: 'approved', consumedAt: null },
    orderBy: { versionNumber: 'desc' },
  });
  return {
    fields: {
      ...(baseFields as Record<string, unknown>),
      ...(approvedOverride
        ? (approvedOverride.fields as Record<string, unknown>)
        : {}),
    },
    approvedOverride,
  };
}

/**
 * บันทึกว่า Override ที่ถูก merge เข้าการส่งครั้งนี้ใช้แล้ว (มติ B 2026-11-03) —
 * mark แถวนั้นและแถว approved ที่ยังไม่ถูกใช้รุ่นก่อนหน้าของ (เครื่อง, Config) เดียวกัน
 * ด้วย (แถวเก่าถูกแถวใหม่แทนแล้ว ไม่ให้โผล่กลับมาหลังแถวใหม่ถูกใช้) · `updateMany`
 * guard ด้วย `consumedAt: null` กันเขียนทับเวลาเดิม
 *
 * เรียกหลังส่งสำเร็จแล้วเท่านั้น จึง **never throws** — mark ไม่สำเร็จแค่ทำให้
 * ค่านี้ถูกส่งซ้ำในครั้งถัดไป ไม่ควรทำให้การส่งที่สำเร็จไปแล้วกลายเป็น error
 */
export async function markOverrideConsumed(
  prisma: PrismaService | Prisma.TransactionClient,
  override: Pick<
    DeviceConfigOverride,
    'id' | 'deviceId' | 'configId' | 'versionNumber'
  > | null,
  consumedAt: Date = new Date(),
): Promise<void> {
  if (!override) return;
  try {
    await prisma.deviceConfigOverride.updateMany({
      where: {
        deviceId: override.deviceId,
        configId: override.configId,
        status: 'approved',
        consumedAt: null,
        versionNumber: { lte: override.versionNumber },
      },
      data: { consumedAt },
    });
  } catch (err) {
    logger.warn(
      `บันทึกว่า Override ${override.id} ถูกใช้แล้วไม่สำเร็จ (ค่านี้จะถูกส่งอีกครั้งในการส่งครั้งถัดไป): ${(err as Error).message}`,
    );
  }
}
