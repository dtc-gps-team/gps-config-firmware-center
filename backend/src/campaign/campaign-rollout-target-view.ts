import type { CampaignRolloutTarget } from '@prisma/client';

/** 1 รอบการส่งของเครื่องหนึ่งใน Rollout (docs/31 §3.3 `CampaignRolloutTargetAttempt`) — ไม่คืนรหัสคำสั่งของ Server กลาง */
export interface RolloutTargetAttempt {
  attemptNo: number;
  /** sending | sent | succeeded | failed | skipped */
  status: string;
  errorCode: string | null;
  detail: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** ฟิลด์ของรอบที่เลือกมาตอนอ่านรายการ (ใช้ซ้ำใน select ของ service) */
export const ROLLOUT_TARGET_ATTEMPT_SELECT = {
  attemptNo: true,
  status: true,
  errorCode: true,
  detail: true,
  startedAt: true,
  finishedAt: true,
} as const;

/**
 * ผลต่อเครื่องของ Rollout ที่คืนจาก `GET .../targets` (docs/31 §6.4): แถวเดิม + รอบล่าสุดของเครื่องนั้น
 * (ให้เว็บแสดงสาเหตุของรอบที่ล้มได้เลยโดยไม่ต้องเรียกประวัติทุกเครื่อง — ประวัติเต็มอยู่ที่
 * `GET .../targets/{targetId}/attempts`)
 *
 * **`nextRetryAt` มีค่าเฉพาะตอน "รอส่งรอบใหม่" จริง** ต่างจากคอลัมน์ใน DB ที่ระหว่างกำลังส่งคือ lease (เวลาที่ถ้า
 * process ตายจะถูกหยิบซ้ำ) ไม่ใช่เวลารอ — ถ้าเปิดค่า lease ออกไปตรงๆ หน้าจอจะนับถอยหลังผิดตอนที่กำลังส่งอยู่
 */
export type CampaignRolloutTargetView = CampaignRolloutTarget & {
  lastAttempt: RolloutTargetAttempt | null;
};

/** รอส่งรอบใหม่ = ยัง pending, ไม่มีคำสั่งค้างที่ Server กลาง, มี nextRetryAt และรอบล่าสุดจบแล้ว (ตัวเดียวกับ progress API) */
export function isWaitingForRetry(
  target: Pick<
    CampaignRolloutTarget,
    'status' | 'centralCommandId' | 'nextRetryAt'
  >,
  lastAttempt: RolloutTargetAttempt | null,
): boolean {
  return (
    target.status === 'pending' &&
    target.centralCommandId === null &&
    target.nextRetryAt !== null &&
    lastAttempt?.finishedAt != null
  );
}

export function toTargetView(
  row: CampaignRolloutTarget & { attempts: RolloutTargetAttempt[] },
): CampaignRolloutTargetView {
  const { attempts, ...target } = row;
  const lastAttempt = attempts[0] ?? null;
  return {
    ...target,
    nextRetryAt: isWaitingForRetry(target, lastAttempt)
      ? target.nextRetryAt
      : null,
    lastAttempt,
  };
}
