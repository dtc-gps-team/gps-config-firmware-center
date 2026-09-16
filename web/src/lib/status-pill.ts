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

/**
 * ข้อความ "ขั้นตอนถัดไป" ต่อสถานะ Config — ตอบ feedback จากที่ประชุมกับอาจารย์
 * (2026-09-15 ข้อ 1.3): แค่โชว์ status pill ไม่พอ ต้องบอกผู้ใช้ด้วยว่าต้องทำ
 * อะไรต่อ · แยกข้อความตาม role เท่าที่มีผลกับสิ่งที่ role นั้นทำได้จริงบนหน้านี้
 * (SW ส่งอนุมัติได้ตอน draft, Operation อนุมัติได้ตอน testing) role อื่นเห็น
 * ข้อความกลางๆ · อ้างอิง flow จริงจาก ConfigReviewPanel + CONFIG_STATUSES ใน
 * backend/src/config/config-status.ts (ไม่ใช่แค่เดา)
 */
export function getConfigNextStepMessage(
  status: string,
  role: string | null | undefined,
): string {
  switch (status) {
    case "draft":
      return role === "SW"
        ? 'ทดสอบแล้วกด "ส่งให้ Operation อนุมัติ" เมื่อพร้อม'
        : "SW กำลังจัดทำ ยังไม่ได้ส่งอนุมัติ";
    case "testing":
      return role === "Operation"
        ? "รอคุณอนุมัติหรือปฏิเสธด้านล่าง"
        : "ส่งให้ Operation อนุมัติแล้ว กำลังรอผลตัดสินใจ";
    // ไม่มี action ต่อจากนี้บนหน้านี้อีกแล้วไม่ว่า role ไหน — เดิมข้อความนี้
    // บอกให้ Operation มอบหมายงานติดตั้งให้ช่างหน้างานผ่าน Task ได้ แต่ Task
    // Management ถูกตัดออกจากระบบนี้ถาวรแล้ว (RBAC_Matrix.md แก้ครั้งที่ 29 —
    // การมอบหมายงานเป็นหน้าที่ของระบบภายนอก) ตามที่พี่เลี้ยงคอมเมนต์ใน PR #165
    case "approved":
      return "อนุมัติแล้ว พร้อมใช้งาน";
    case "rejected":
      return 'ถูกปฏิเสธ ใช้ปุ่ม "โคลน Config" ด้านบนเพื่อแก้ไขแล้วส่งใหม่';
    case "synced":
      return "ซิงก์เข้าระบบเดิมเรียบร้อยแล้ว ใช้งานได้เต็มรูปแบบ";
    default:
      return "";
  }
}

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
