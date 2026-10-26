import type { PillTone } from "@/lib/status-pill";
import type { CentralDevice } from "@/lib/central-device-api";

const COMMAND_STATUS_LABEL: Record<string, string> = {
  PENDING: "รอส่งให้กล่อง",
  DELIVERED: "ส่งถึงกล่องแล้ว",
  ACKNOWLEDGED: "กล่องรับคำสั่งแล้ว",
  DOWNLOADING: "กำลังดาวน์โหลด",
  VALIDATING: "กำลังตรวจสอบ",
  INSTALLING: "กำลังติดตั้ง",
  REBOOTING: "กำลังรีบูต",
  SUCCESS: "สำเร็จ",
  FAILED: "ล้มเหลว",
  ROLLED_BACK: "ย้อนกลับแล้ว",
  EXPIRED: "หมดอายุ",
};

const COMMAND_STATUS_TONE: Record<string, PillTone> = {
  SUCCESS: "success",
  FAILED: "danger",
  ROLLED_BACK: "danger",
  EXPIRED: "danger",
};

const COMMAND_ACTION_LABEL: Record<string, string> = {
  UPDATE_CONFIG: "อัปเดต Config",
  UPDATE_FIRMWARE: "อัปเดต Firmware",
};

/** สถานะที่ไม่รู้จักแสดงตามที่ Server กลางส่งมา ไม่ซ่อนและไม่ error */
export function centralCommandStatusLabel(status: string): string {
  return COMMAND_STATUS_LABEL[status] ?? status;
}

/** สถานะระหว่างทางทั้งหมดเป็น `progress` (ยังไม่นิ่ง) ส่วนที่ไม่รู้จักเป็น `neutral` */
export function centralCommandStatusTone(status: string): PillTone {
  if (COMMAND_STATUS_TONE[status]) return COMMAND_STATUS_TONE[status];
  return status in COMMAND_STATUS_LABEL ? "progress" : "neutral";
}

export function centralCommandActionLabel(action: string): string {
  return COMMAND_ACTION_LABEL[action] ?? action;
}

/** คำสั่งที่ยังไม่จบ (ไม่ใช่ SUCCESS/FAILED/ROLLED_BACK/EXPIRED) */
export function isCentralCommandInFlight(status: string): boolean {
  return !["SUCCESS", "FAILED", "ROLLED_BACK", "EXPIRED"].includes(status);
}

/** ชื่อโมเดลของ Server กลาง (`hardware_model`) ตรงกับโมเดลในระบบเราหรือไม่ (ไม่สนตัวพิมพ์) */
export function matchModelIdByHardwareModel(
  hardwareModel: string | null,
  models: { id: string; name: string }[],
): string | null {
  if (!hardwareModel) return null;
  const wanted = hardwareModel.trim().toLowerCase();
  return models.find((m) => m.name.trim().toLowerCase() === wanted)?.id ?? null;
}

/** Map deviceId -> สถานะออนไลน์ สำหรับคอลัมน์ในรายการ */
export function onlineByDeviceId(
  devices: CentralDevice[],
): Map<string, CentralDevice> {
  return new Map(devices.map((d) => [d.deviceId, d]));
}
