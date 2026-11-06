import type {
  FieldApplyAttempt,
  FieldApplyProgress,
  FieldApplyRequestStatus,
} from "@/lib/field-apply-request-api";
import type { PillTone } from "@/lib/status-pill";

/**
 * ฟังก์ชัน pure ของการแสดงผลลองส่งใหม่อัตโนมัติ (docs/31 §3.7) — กติกาเดียวกับหน้าความคืบหน้าบน Mobile
 * (`config_apply_progress_page.dart`) เพื่อให้ช่างกับ Operation เห็นตรงกัน
 */

export const FIELD_APPLY_STATUS_LABEL: Record<FieldApplyRequestStatus, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว รอช่างกดส่ง",
  sending: "กำลังส่งเข้ากล่อง",
  succeeded: "ส่งสำเร็จ",
  failed: "ส่งไม่สำเร็จ",
  skipped_offline: "ข้าม (กล่องออฟไลน์)",
  rejected: "ถูกปฏิเสธ",
  cancelled: "ยกเลิก",
  expired: "หมดอายุ",
};

export const FIELD_APPLY_STATUS_TONE: Record<FieldApplyRequestStatus, PillTone> = {
  pending: "neutral",
  approved: "info",
  sending: "progress",
  succeeded: "success",
  failed: "danger",
  skipped_offline: "neutral",
  rejected: "danger",
  cancelled: "neutral",
  expired: "neutral",
};

export const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  sending: "กำลังส่ง",
  sent: "ส่งแล้ว รอผล",
  succeeded: "สำเร็จ",
  failed: "ไม่สำเร็จ",
  skipped: "ข้าม (กล่องไม่พร้อม)",
};

/** กำลังรอส่งรอบใหม่: backend ให้ `nextRetryAt` เฉพาะช่วงนี้ */
export function isWaitingRetry(progress: FieldApplyProgress | null): boolean {
  return (
    progress?.status === "sending" && progress.retry?.nextRetryAt != null
  );
}

/** เลขรอบบนป้าย "รอบ 2/3": รอรอบใหม่ = รอบที่กำลังจะส่ง · null = ไม่แสดง (ยังเป็นรอบแรก หรือไม่มีข้อมูลรายรอบ) */
export function badgeAttempt(progress: FieldApplyProgress | null): number | null {
  const retry = progress?.retry;
  if (!retry || retry.maxAttempts <= 1) return null;
  const n = isWaitingRetry(progress) ? retry.attemptNo + 1 : retry.attemptNo;
  return n > 1 ? n : null;
}

/** ประวัติรายรอบแสดงเมื่อมีมากกว่า 1 รอบ หรือรอบเดียวที่ไม่สำเร็จ/ถูกข้าม (สำเร็จรอบแรกไม่ต้องแสดง) */
export function showAttemptHistory(attempts: FieldApplyAttempt[]): boolean {
  return (
    attempts.length > 1 ||
    attempts.some((a) => a.status === "failed" || a.status === "skipped")
  );
}

export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * ข้อความนับถอยหลังตอนรอรอบใหม่ — ถึงเวลาแล้วขึ้น "ส่งรอบใหม่แล้ว รอกล่องตอบ" แทนการนับต่อหรือค้างที่ 0:00
 * (กล่องจริงอาจค้าง PENDING นานเกือบ 1 นาทีหลังรอบใหม่เริ่ม — ทดสอบกับ BOX-0001) · ใช้นาฬิกาเครื่องผู้ใช้
 * เทียบเวลาจากเซิร์ฟเวอร์ ถ้านาฬิกาเคลื่อนอาจเปลี่ยนข้อความเร็ว/ช้ากว่าจริงเล็กน้อย
 */
export function retryCountdownText(nextRetryAt: string, now: number): string {
  const left = Math.ceil((new Date(nextRetryAt).getTime() - now) / 1000);
  return left > 0
    ? `จะลองส่งใหม่ในอีก ${formatMmSs(left)}`
    : "ส่งรอบใหม่แล้ว รอกล่องตอบ";
}

/** ข้อความสรุปเมื่อส่งไม่สำเร็จ: หลายรอบ = "ส่ง N ครั้งไม่สำเร็จ" */
export function failureTitle(attempts: FieldApplyAttempt[]): string {
  return attempts.length > 1
    ? `ส่ง ${attempts.length} ครั้งไม่สำเร็จ`
    : "ส่งไม่สำเร็จ";
}

/** เหตุผลของรอบล่าสุดที่ล้ม/ถูกข้าม (ข้อความอ่านง่ายก่อน ไม่มีใช้รหัส) */
export function lastFailureReason(attempts: FieldApplyAttempt[]): string | null {
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i];
    if (a.status === "failed" || a.status === "skipped") {
      return a.detail ?? a.errorCode;
    }
  }
  return null;
}
