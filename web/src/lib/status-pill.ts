/**
 * Status pill — className helper สำหรับ badge สถานะ (Config / Task / Device ฯลฯ)
 *
 * signal color ของ status **แยกจาก** theme token ใน globals.css โดยตั้งใจ —
 * ไม่ผูกกับ --primary/--accent (สีเตือนต้องคงที่ข้าม theme) ใช้ Tailwind
 * default palette ตรง ๆ
 *
 * เดิมอยู่ใน `demo-data.ts` — ย้ายออกมาเพราะไม่ใช่ข้อมูล demo แต่เป็น UI helper
 * ที่หน้าจริง (ต่อ API แล้ว) ก็ใช้ · `demo-data.ts` re-export ต่อให้หน้าที่ยัง
 * เป็น scaffold ใช้ได้เหมือนเดิม
 */

export type PillTone = "neutral" | "info" | "progress" | "success" | "danger";

const PILL_TONE: Record<PillTone, string> = {
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  progress: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  success:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  danger: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

export function pillClass(tone: PillTone): string {
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PILL_TONE[tone]}`;
}

/** Config lifecycle: draft → testing → approved → synced (rejected = ย้อน draft) */
export const CONFIG_STATUS_TONE: Record<string, PillTone> = {
  draft: "neutral",
  testing: "progress",
  approved: "success",
  synced: "info",
  rejected: "danger",
};

export const TASK_STATUS_TONE: Record<string, PillTone> = {
  pending: "neutral",
  in_progress: "progress",
  completed: "success",
  cancelled: "danger",
};

export const DEVICE_STATUS_TONE: Record<string, PillTone> = {
  registered: "neutral",
  installed: "success",
  decommissioned: "danger",
};

/** Campaign lifecycle: v1 สร้างแล้ว active ทันที (ไม่มี draft/approval
 * workflow ของตัวเอง) — completed/cancelled ยังไม่มี endpoint เปลี่ยนสถานะ
 * เข้า-ออก (รอ Campaign Monitor, Sprint 3 #22) */
export const CAMPAIGN_STATUS_TONE: Record<string, PillTone> = {
  draft: "neutral",
  active: "progress",
  completed: "success",
  cancelled: "danger",
};

/** Firmware.uploadStatus — `pending` แทบไม่เจอจริงตอนนี้ (upload() ของ backend
 * ตั้งเป็น stored/failed ทันทีเสมอ เพราะอัปโหลดขึ้น Object Storage แบบ
 * synchronous) แต่ enum อนุญาตไว้เผื่ออนาคต (เช่น อัปโหลดไฟล์ใหญ่แบบ async) */
export const FIRMWARE_UPLOAD_STATUS_TONE: Record<string, PillTone> = {
  pending: "progress",
  stored: "success",
  failed: "danger",
};

/** Firmware.deviceUpdateStatus — คงเป็น `unknown` เสมอตอนนี้ (รอ device-status
 * module — ดู RBAC_Matrix.md Section 6) แต่ใส่ tone ให้ครบ enum ไว้ก่อน */
export const FIRMWARE_DEVICE_UPDATE_STATUS_TONE: Record<string, PillTone> = {
  unknown: "neutral",
  up_to_date: "success",
  pending_update: "progress",
};
