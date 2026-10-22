import { apiJson } from "@/lib/api";

/**
 * Central Device API client — ตรงกับ `docs/api/openapi.yaml` tag `device`
 * (`getCentralStatus` / `listCentralDevices` / `getDeviceCentral`)
 *
 * ข้อมูลสถานะจริงของกล่องจาก Server กลาง (ESP32 Central Management) อ่านอย่างเดียว
 * ติดต่อ Server กลางไม่ได้ **ไม่ใช่ error** — backend ตอบ 200 พร้อม `reachable: false`
 */

export type CentralMode = "mock" | "real";

export type CentralLastCommand = {
  commandId: string;
  /** เช่น `UPDATE_CONFIG`, `UPDATE_FIRMWARE` */
  action: string;
  /** เวอร์ชันเป้าหมายเป็นข้อความเสมอ */
  target: string | null;
  /** รับค่าใหม่ได้ในอนาคต — ผู้เรียกต้องรับสถานะที่ไม่รู้จักได้ */
  status: string;
  errorCode: string | null;
  updatedAt: string | null;
};

export type CentralDevice = {
  deviceId: string;
  hardwareModel: string | null;
  online: boolean;
  lastSeenAt: string | null;
  reportedFirmwareVersion: string | null;
  reportedConfigVersion: number | null;
  reportedSchemaVersion: number | null;
  desiredConfigVersion: number | null;
  /** อยู่ในทะเบียนของ delivery-server หรือไม่ (ไม่อยู่ = สั่ง Config ไม่ได้) */
  registered: boolean;
  lastCommand: CentralLastCommand | null;
};

type CentralReachability = {
  mode: CentralMode;
  /** `false` = ติดต่อ Server กลางไม่ได้ตอนนี้ */
  reachable: boolean;
  /** เหตุผลสั้นๆ เมื่อ `reachable=false` */
  error: string | null;
  fetchedAt: string;
};

export type CentralDeviceList = CentralReachability & {
  devices: CentralDevice[];
};

export type DeviceCentralView = CentralReachability & {
  /** `null` = Server กลางไม่รู้จักเครื่องนี้ */
  device: CentralDevice | null;
};

/** `GET /central/devices` — ทุก Role ที่อ่านอุปกรณ์ได้ */
export function listCentralDevices(token: string): Promise<CentralDeviceList> {
  return apiJson<CentralDeviceList>("/central/devices", { token });
}

/** `GET /devices/{deviceId}/central` */
export function getDeviceCentral(
  token: string,
  deviceId: string,
): Promise<DeviceCentralView> {
  return apiJson<DeviceCentralView>(
    `/devices/${encodeURIComponent(deviceId)}/central`,
    { token },
  );
}
