import type { CampaignRolloutTarget } from "@/lib/campaign-api";

/** จำนวนรอบสูงสุดของการลองส่งใหม่ (docs/31: ส่งครั้งแรก + ลองใหม่อีก 2 ครั้ง) */
export const ROLLOUT_MAX_ATTEMPTS = 3;

type RetryFields = Pick<CampaignRolloutTarget, "attemptCount" | "nextRetryAt">;

/** กำลังรอส่งรอบใหม่: backend ให้ `nextRetryAt` เฉพาะช่วงนี้ */
export function isTargetWaitingRetry(target: RetryFields): boolean {
  return target.nextRetryAt != null;
}

/**
 * เลขรอบบนป้าย "รอบ 2/3": รอรอบใหม่ = รอบที่กำลังจะส่ง (attemptCount + 1) · ไม่งั้นรอบที่ส่งไปแล้ว ·
 * null = ไม่แสดง (ยังเป็นรอบแรก) — กติกาเดียวกับหน้าอุปกรณ์ (`badgeAttempt`)
 */
export function targetBadgeAttempt(target: RetryFields): number | null {
  const n = isTargetWaitingRetry(target)
    ? target.attemptCount + 1
    : target.attemptCount;
  return n > 1 ? Math.min(n, ROLLOUT_MAX_ATTEMPTS) : null;
}

/** ปุ่ม "ดูประวัติ" แสดงเมื่อส่งมากกว่า 1 รอบ หรือรอบเดียวที่ไม่สำเร็จ/ถูกข้าม */
export function targetHasHistory(
  target: RetryFields & Pick<CampaignRolloutTarget, "lastAttempt">,
): boolean {
  if (target.attemptCount > 1 || isTargetWaitingRetry(target)) return true;
  const last = target.lastAttempt;
  return (
    last != null && (last.status === "failed" || last.status === "skipped")
  );
}
