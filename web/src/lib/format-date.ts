/** ฟอร์แมตวันที่/เวลา ภาษาไทย (พ.ศ.) — ใช้ร่วมทุกหน้า */

/** วันที่ + เวลาแบบเต็ม เช่น "8 ก.ย. 2569 15:03" — ใช้ในแผงรายละเอียด/tooltip */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

const relativeTimeFormat = new Intl.RelativeTimeFormat("th", {
  numeric: "auto",
});

/**
 * เวลาสัมพัทธ์สำหรับคอลัมน์ในตาราง list เช่น "3 นาทีที่แล้ว" / "เมื่อวาน" —
 * เกิน ~30 วันโชว์วันที่แบบสั้นแทน (เวลาเต็มดูได้ในแผงรายละเอียด)
 */
export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";

  const diffMs = d.getTime() - Date.now();
  if (Math.abs(diffMs) < 45_000) return "เมื่อสักครู่";

  const mins = Math.round(diffMs / 60_000);
  if (Math.abs(mins) < 60) return relativeTimeFormat.format(mins, "minute");

  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) return relativeTimeFormat.format(hours, "hour");

  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(days) < 30) return relativeTimeFormat.format(days, "day");

  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** เกณฑ์ "ค้างคิวนาน" สำหรับการ์ดรออนุมัติ — ไม่มี field ความสำคัญ/priority
 * จริงในระบบ (PDF มีแนวคิดนี้แต่ยังไม่ implement) จึงใช้เวลาที่ค้างคิวจริง
 * แทน เป็นสัญญาณที่มีข้อมูลรองรับจริง ไม่ใช่ค่าสมมติ */
const STALE_PENDING_HOURS = 24;

/** true ถ้ารายการนี้เข้าคิวมานานเกินเกณฑ์ — ใช้เน้นการ์ดรออนุมัติที่ควรรีบดู
 * ก่อน (ApprovalCard/CampaignRolloutApprovalCard/
 * DeviceConfigOverrideApprovalCard) */
export function isStalePending(
  iso: string,
  thresholdHours: number = STALE_PENDING_HOURS,
): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > thresholdHours * 3_600_000;
}

/** ข้อความ "ค้างมา X วัน/ชม." สำหรับ badge บนการ์ดที่ `isStalePending` — คืน
 * `null` ถ้ายังไม่เข้าเกณฑ์ (ไม่ต้องโชว์ badge) */
export function stalePendingLabel(
  iso: string,
  thresholdHours: number = STALE_PENDING_HOURS,
): string | null {
  if (!isStalePending(iso, thresholdHours)) return null;
  const d = new Date(iso);
  const hours = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  const days = Math.floor(hours / 24);
  return days >= 1 ? `ค้างมา ${days} วัน` : `ค้างมา ${hours} ชม.`;
}
