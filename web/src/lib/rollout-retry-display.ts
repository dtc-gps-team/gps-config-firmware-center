import {
  DEFAULT_AUTO_RETRY_MAX_ATTEMPTS,
  type CampaignRolloutTarget,
} from "@/lib/campaign-api";

/** ฟังก์ชันด้านล่างรับ `maxAttempts` จาก API (`useAutoRetryMaxAttempts`) · ไม่ส่งมาใช้ค่าเริ่มต้นของ backend */

type RetryFields = Pick<CampaignRolloutTarget, "attemptCount" | "nextRetryAt">;

/** กำลังรอส่งรอบใหม่: backend ให้ `nextRetryAt` เฉพาะช่วงนี้ */
export function isTargetWaitingRetry(target: RetryFields): boolean {
  return target.nextRetryAt != null;
}

/**
 * เลขรอบบนป้าย "รอบ 2/3": รอรอบใหม่ = รอบที่กำลังจะส่ง (attemptCount + 1) · ไม่งั้นรอบที่ส่งไปแล้ว ·
 * null = ไม่แสดง (ยังเป็นรอบแรก) — กติกาเดียวกับหน้าอุปกรณ์ (`badgeAttempt`)
 */
export function targetBadgeAttempt(
  target: RetryFields,
  maxAttempts: number = DEFAULT_AUTO_RETRY_MAX_ATTEMPTS,
): number | null {
  const n = isTargetWaitingRetry(target)
    ? target.attemptCount + 1
    : target.attemptCount;
  return n > 1 ? Math.min(n, maxAttempts) : null;
}

/**
 * ส่งครบทุกรอบแล้วก็ยังไม่สำเร็จ: ล้ม หรือถูกข้ามเพราะกล่องออฟไลน์ครบทุกรอบ (ไม่ใช่ล้มรอบแรกตอนปิดสวิตช์) ·
 * กลุ่มนี้คือเครื่องที่ Operation อยากตามต่อที่สุด
 */
export function isTargetRetryExhausted(
  target: RetryFields & Pick<CampaignRolloutTarget, "status">,
  maxAttempts: number = DEFAULT_AUTO_RETRY_MAX_ATTEMPTS,
): boolean {
  return (
    (target.status === "failed" || target.status === "skipped_offline") &&
    target.attemptCount >= maxAttempts
  );
}

/** จำนวนเครื่องที่กำลังรอส่งรอบใหม่ (นับเป็น "รอผล" ในแถบความคืบหน้า) */
export function countRetryingTargets(targets: RetryFields[]): number {
  return targets.filter(isTargetWaitingRetry).length;
}

export type TargetRetryFilter = "all" | "retrying" | "exhausted";

export function filterTargetsByRetry<
  T extends RetryFields & Pick<CampaignRolloutTarget, "status">,
>(
  targets: T[],
  filter: TargetRetryFilter,
  maxAttempts: number = DEFAULT_AUTO_RETRY_MAX_ATTEMPTS,
): T[] {
  if (filter === "retrying") return targets.filter(isTargetWaitingRetry);
  if (filter === "exhausted") {
    return targets.filter((t) => isTargetRetryExhausted(t, maxAttempts));
  }
  return targets;
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
