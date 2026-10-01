import { DeviceConfigOverride, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * merge แถว `DeviceConfigOverride` สถานะ `approved` ล่าสุด (`versionNumber`
 * มากสุด) ของ (deviceId, configId) ทับ base fields — ใช้ร่วมกันโดย
 * `DeviceService` (`applyConfig()`/`simulateConfig()`/`getCurrentConfig()`)
 * และ `CampaignRolloutService` (`autoApplyConfig()`, #235 review comment ข้อ
 * 1) เพื่อให้ทุกจุดที่ "ใส่ Config เข้าอุปกรณ์" ได้ค่าเดียวกันเสมอ ไม่ว่าจะมา
 * จากช่างกด apply-config เองหรือ Campaign auto-apply (issue #223/#226) ·
 * pending/rejected ไม่มีผล · `approvedOverride` เป็น `null` เมื่อไม่มีแถว
 * approved (fields = base เดิม)
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
    where: { deviceId, configId, status: 'approved' },
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
