/**
 * ประวัติของอุปกรณ์ 1 เครื่อง (`GET /devices/{deviceId}/history`) — รวมเหตุการณ์
 * จากตารางเดิมเป็นเส้นเวลาเดียว **ไม่มีตารางประวัติใหม่** (ไม่เก็บซ้ำ) ตอบโจทย์รีวิว
 * พี่เลี้ยง 19 ต.ค. 2569: เครื่องนี้เคยทำอะไรมาบ้าง อัปเดต Config เทมเพลตไหนมา
 *
 * ออกแบบให้ชนิดรายการเพิ่มได้โดยไม่ต้องรื้อ (เช่น สถานะ job ของกล่องจาก Server กลาง
 * ของพี่เลี้ยงในอนาคต) — ฝั่งเว็บต้องรับชนิดที่ไม่รู้จักได้โดยไม่พัง
 */

/** ชนิดรายการในเส้นเวลา */
export const DEVICE_HISTORY_TYPES = [
  'lifecycle', // ลงทะเบียน / ติดตั้ง
  'rollout', // ถูกรวมใน Rollout (Config หรือ Firmware)
  'config-override', // คำขอแก้ค่าเฉพาะเครื่อง
  'firmware-override', // คำขอติดตั้ง Firmware ที่ไม่ตรงกับ Campaign
  'task', // งานที่ช่างได้รับ (เช่น ติดตั้ง Config)
  'incident', // ปัญหาที่แจ้ง หรือ Incident จาก Rollout ที่เครื่องนี้ล้ม
] as const;
export type DeviceHistoryType = (typeof DEVICE_HISTORY_TYPES)[number];

export interface DeviceHistoryConfigRef {
  id: string;
  name: string;
  /** เวอร์ชันของ Config ที่ใช้ ณ ตอนนั้น (เวอร์ชันที่อนุมัติล่าสุดก่อนเวลาเหตุการณ์)
   * — best effort: Rollout ไม่ได้เก็บเลขเวอร์ชันไว้ตรงๆ จึงประมาณจากเวลาอนุมัติ
   * null ถ้าหาไม่ได้ */
  versionNumber: number | null;
}

export interface DeviceHistoryFirmwareRef {
  id: string;
  version: string;
}

export interface DeviceHistoryDecision {
  byId: string | null;
  at: string | null;
  /** เหตุผลที่ปฏิเสธ (ถ้ามี) */
  note: string | null;
}

export interface DeviceHistoryItem {
  /** คีย์เฉพาะของรายการ เช่น `rollout:<targetId>` ใช้เป็น cursor tie-break และ
   * key ฝั่งเว็บ */
  id: string;
  type: DeviceHistoryType;
  /** เวลาของเหตุการณ์ (ISO) ใช้เรียงและแบ่งหน้า */
  occurredAt: string;
  /** สถานะของรายการตามชนิด: rollout = สถานะเป้าหมาย (pending/success/failed/
   * skipped_offline), override = pending/approved/rejected, task = สถานะ Task,
   * incident = สถานะ Incident, lifecycle = registered/installed */
  status: string | null;
  /** ชื่อเรื่อง: ชื่อแคมเปญ, ชื่อ Task, ชื่อ Incident (null สำหรับ override/lifecycle) */
  title: string | null;
  /** ผลหรือเหตุผล: ข้อผิดพลาดของ Rollout, เหตุผลของคำขอแก้ค่า, คำอธิบาย Incident */
  detail: string | null;
  /** ผู้ทำรายการ: ผู้ขอแก้ค่า (override), ช่างที่ได้รับงาน (task), ผู้แจ้ง (incident) */
  actorId: string | null;
  /** เฉพาะ rollout: Config หรือ Firmware */
  payloadType: 'Config' | 'Firmware' | null;
  /** เฉพาะ rollout: เป็นการ Rollback หรือไม่ */
  isRollback: boolean | null;
  /** เฉพาะ incident: ความรุนแรง */
  severity: string | null;
  config: DeviceHistoryConfigRef | null;
  firmware: DeviceHistoryFirmwareRef | null;
  /** เฉพาะ override: การตัดสินใจของ Operation (null จนกว่าจะตัดสินใจ) */
  decision: DeviceHistoryDecision | null;
  refs: {
    campaignId: string | null;
    rolloutId: string | null;
    taskId: string | null;
    incidentId: string | null;
    overrideId: string | null;
  };
}

export interface DeviceHistorySummary {
  /** Config ที่ใช้อยู่ตอนนี้ (null ถ้ายังไม่เคยมี Config ที่ยืนยันติดตั้ง) */
  currentConfig: { id: string; name: string } | null;
  /** Firmware ที่ใช้อยู่ตอนนี้ (null ถ้ายังไม่เคยมี Firmware ที่ติดตั้งสำเร็จ) */
  currentFirmware: DeviceHistoryFirmwareRef | null;
}

export interface DeviceHistoryResult {
  summary: DeviceHistorySummary;
  /** ใหม่ไปเก่า */
  items: DeviceHistoryItem[];
  /** ส่งกลับมาเป็น `before` เพื่อดึงหน้าถัดไป · null = หมดแล้ว */
  nextCursor: string | null;
}
