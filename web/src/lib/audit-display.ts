/**
 * ข้อความภาษาไทยของ AuditLog (`auditModule` / `action` จาก `GET /audit-logs`)
 * ใช้ร่วมกันระหว่าง "กิจกรรมล่าสุด" บน Dashboard กับตัวกรองโมดูลในหน้า Audit Log
 *
 * mirror `AUDIT_MODULE` และ action ที่แต่ละ service ฝั่ง backend เขียนจริง
 * (`prisma.auditLog.create`) · ค่าที่ไม่อยู่ใน map (เพิ่มใหม่ทีหลัง) แสดงค่าดิบแทน
 * ไม่ error · บาง action เก่าที่ไม่ได้เขียนแล้ว (`create-rollout`, `override`,
 * `upload`) ยังเก็บไว้เพราะแถวเดิมใน DB ยังมีอยู่
 */

/** โมดูลที่เขียน AuditLog เรียงตามลำดับที่แสดงในตัวกรอง */
export const AUDIT_MODULE_LABEL: Record<string, string> = {
  config: "Config",
  "config-definition": "พารามิเตอร์",
  "config-deletion": "คำขอลบ Config",
  "config-apply-request": "คำขอส่งเข้ากล่อง",
  firmware: "Firmware",
  campaign: "Campaign",
  device: "อุปกรณ์",
  "device-model": "รุ่นอุปกรณ์",
  incident: "Incident",
  task: "งานหน้างาน",
  customer: "ลูกค้า",
  user: "บัญชีผู้ใช้",
};

export const AUDIT_MODULE_OPTIONS = Object.entries(AUDIT_MODULE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** action ที่เป็นคำกริยา ต่อท้ายด้วยชื่อโมดูล ("อนุมัติ Config") */
const ACTION_VERB: Record<string, string> = {
  create: "สร้าง",
  update: "แก้ไข",
  approve: "อนุมัติ",
  reject: "ปฏิเสธ",
  delete: "ลบ",
  // config: ส่งผลทดสอบ (testing -> approved/rejected) · incident ดู auditActivityText
  decide: "ส่งผลทดสอบของ",
  "apply-config": "นำ Config ไปใช้กับ",
  keep: "คงสถานะ",
  upload: "อัปโหลด",
  register: "ลงทะเบียน",
  decommission: "ปลดระวาง",
  reactivate: "นำกลับมาใช้",
  activate: "เปิดใช้",
  deactivate: "ปิดใช้",
  report: "รายงาน",
  "retry-sync": "สั่งส่งใหม่ของ",
  release: "ปล่อย Rollout ของ",
  rollback: "สั่ง Rollback ของ",
  resume: "ทำต่อ",
  resumed: "ทำต่อ",
  start: "เริ่ม",
  add_note: "เพิ่มบันทึกใน",
  add_targets: "เพิ่มเครื่องเป้าหมายใน",
  remove_target: "เอาเครื่องเป้าหมายออกจาก",
  "create-rollout": "สร้าง Rollout ใน",
  override: "Override",
  "rotate-key": "ออก API key ใหม่ของ",
};

/** action ที่บอกเรื่องครบในตัวเองแล้ว แสดงประโยคนี้แทน "คำกริยา + โมดูล"
 * (ไม่งั้นจะซ้ำ เช่น "ขอส่งเข้ากล่อง คำขอส่งเข้ากล่อง") */
const ACTION_PHRASE: Record<string, string> = {
  config_apply_request: "ส่งคำขอส่งเข้ากล่อง",
  config_apply_approve: "อนุมัติคำขอส่งเข้ากล่อง",
  config_apply_reject: "ปฏิเสธคำขอส่งเข้ากล่อง",
  config_apply_cancel: "ยกเลิกคำขอส่งเข้ากล่อง",
  config_apply_release: "สั่งส่งเข้ากล่อง",
  config_apply_direct: "ส่ง Config เข้ากล่องโดยตรง",
  "device-config-override-request": "ขอ Override Config ของอุปกรณ์",
  "device-config-override-approve": "อนุมัติ Override Config ของอุปกรณ์",
  "device-config-override-reject": "ปฏิเสธ Override Config ของอุปกรณ์",
  "device-firmware-override-request": "ขอ Override Firmware ของอุปกรณ์",
  "device-firmware-override-approve": "อนุมัติ Override Firmware ของอุปกรณ์",
  "device-firmware-override-reject": "ปฏิเสธ Override Firmware ของอุปกรณ์",
  "confirm-install": "ยืนยันติดตั้งอุปกรณ์",
  "confirm-firmware-install": "ยืนยันติดตั้ง Firmware ของอุปกรณ์",
};

export function auditModuleLabel(auditModule: string): string {
  return AUDIT_MODULE_LABEL[auditModule] ?? auditModule;
}

/** ประโยคสั้นของสิ่งที่ทำ (ไม่รวมชื่อผู้ทำ) เช่น "อนุมัติ Config" */
export function auditActivityText(action: string, auditModule: string): string {
  const phrase = ACTION_PHRASE[action];
  if (phrase) return phrase;
  // incident decide = ตัดสินรายงานจากหน้างาน (ไม่ใช่ผลทดสอบแบบของ Config)
  if (action === "decide" && auditModule === "incident") return "ตัดสิน Incident";
  const verb = ACTION_VERB[action] ?? action;
  return `${verb} ${auditModuleLabel(auditModule)}`;
}
