import { apiJson } from "@/lib/api";

/**
 * Device History API client — `GET /devices/{deviceId}/history` (docs/14 ส่วน
 * ขยาย, รีวิวพี่เลี้ยง 19 ต.ค. 2569) รวมเหตุการณ์จากตารางเดิมเป็นเส้นเวลาเดียว
 * ของอุปกรณ์เครื่องเดียว **ไม่มีตารางประวัติใหม่** ชนิดรายการเพิ่มได้ในอนาคต —
 * ฝั่งนี้ต้องรับชนิดที่ไม่รู้จักได้โดยไม่พัง (ดู `DeviceHistoryType`)
 */

export const DEVICE_HISTORY_TYPES = [
  "lifecycle",
  "rollout",
  "config-override",
  "firmware-override",
  "task",
  "incident",
] as const;
export type DeviceHistoryType = (typeof DEVICE_HISTORY_TYPES)[number];

export type DeviceHistoryConfigRef = {
  id: string;
  name: string;
  /** เวอร์ชันที่อนุมัติล่าสุดก่อนเวลาเหตุการณ์ (ประมาณ) null = หาไม่ได้ */
  versionNumber: number | null;
};

export type DeviceHistoryFirmwareRef = {
  id: string;
  version: string;
};

export type DeviceHistoryDecision = {
  byId: string | null;
  at: string | null;
  /** เหตุผลที่ปฏิเสธ (ถ้ามี) */
  note: string | null;
};

export type DeviceHistoryItem = {
  /** คีย์เฉพาะของรายการ เช่น `rollout:<targetId>` */
  id: string;
  /** ชนิดรายการ — อาจเจอค่าที่ไม่อยู่ใน `DEVICE_HISTORY_TYPES` ได้ในอนาคต
   * (backend เพิ่มชนิดใหม่โดยไม่ต้องรอฝั่งเว็บ) ต้องแสดงแบบ fallback ได้ */
  type: DeviceHistoryType | string;
  occurredAt: string;
  status: string | null;
  title: string | null;
  detail: string | null;
  actorId: string | null;
  payloadType: "Config" | "Firmware" | null;
  isRollback: boolean | null;
  severity: string | null;
  config: DeviceHistoryConfigRef | null;
  firmware: DeviceHistoryFirmwareRef | null;
  decision: DeviceHistoryDecision | null;
  refs: {
    campaignId: string | null;
    rolloutId: string | null;
    taskId: string | null;
    incidentId: string | null;
    overrideId: string | null;
  };
};

export type DeviceHistorySummary = {
  currentConfig: { id: string; name: string } | null;
  currentFirmware: DeviceHistoryFirmwareRef | null;
};

export type DeviceHistoryResult = {
  summary: DeviceHistorySummary;
  /** ใหม่ไปเก่า */
  items: DeviceHistoryItem[];
  /** ส่งกลับมาเป็น `before` เพื่อดึงหน้าถัดไป — null = หมดแล้ว */
  nextCursor: string | null;
};

/** `GET /devices/{deviceId}/history` — ทุก Role ที่อ่านอุปกรณ์ได้
 * `before` = `nextCursor` ของหน้าก่อนหน้า (ไม่ส่ง = หน้าแรก) · `types` กรอง
 * ชนิดรายการ (ไม่ส่ง หรือส่งว่าง = ทุกชนิด เหมือนไม่กรอง) */
export function getDeviceHistory(
  token: string,
  deviceId: string,
  options?: { before?: string; types?: DeviceHistoryType[] },
): Promise<DeviceHistoryResult> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  if (options?.types && options.types.length > 0) {
    params.set("types", options.types.join(","));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return apiJson<DeviceHistoryResult>(
    `/devices/${encodeURIComponent(deviceId)}/history${query}`,
    { token },
  );
}
