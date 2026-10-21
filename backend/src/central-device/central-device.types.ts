/** คำสั่งล่าสุดที่ Server กลางส่งให้กล่อง (ตัดเหลือเท่าที่หน้าเว็บใช้) */
export interface CentralLastCommand {
  commandId: string;
  action: string;
  /** เวอร์ชันเป้าหมายเป็นข้อความเสมอ (Server กลางส่งเลขสำหรับ config, ข้อความสำหรับ firmware) */
  target: string | null;
  status: string;
  errorCode: string | null;
  updatedAt: string | null;
}

/** กล่องหนึ่งเครื่องตามที่ Server กลางรายงาน — ผสมจาก gateway (ออนไลน์) และ delivery (ทะเบียน) */
export interface CentralDevice {
  deviceId: string;
  hardwareModel: string | null;
  online: boolean;
  lastSeenAt: string | null;
  reportedFirmwareVersion: string | null;
  reportedConfigVersion: number | null;
  reportedSchemaVersion: number | null;
  /** เวอร์ชัน Config ที่ Server กลางตั้งเป้าไว้ (`null` = ยังไม่เคยตั้ง หรือกล่องไม่อยู่ในทะเบียน delivery) */
  desiredConfigVersion: number | null;
  /** กล่องอยู่ในทะเบียนของ delivery-server หรือไม่ (ไม่อยู่ = สั่ง Config ไม่ได้) */
  registered: boolean;
  lastCommand: CentralLastCommand | null;
}

export type CentralMode = 'mock' | 'real';

export interface CentralDeviceList {
  mode: CentralMode;
  /** `false` = ติดต่อ Server กลางไม่ได้ ตอนนี้ `devices` เป็นค่าว่าง */
  reachable: boolean;
  /** เหตุผลสั้นๆ เมื่อ `reachable=false` (ไม่มีข้อมูลลับ) */
  error: string | null;
  fetchedAt: string;
  devices: CentralDevice[];
}

export interface CentralStatus {
  mode: CentralMode;
  reachable: boolean;
  error: string | null;
  checkedAt: string;
}

/** รูปแบบดิบจาก `GET /api/gw/devices` ของ ws-gateway (ผ่าน delivery-server) */
export interface RawGatewayDevice {
  device_id: string;
  hardware_model?: string | null;
  online?: boolean;
  last_seen_at?: string | null;
  firmware_version_reported?: string | null;
  config_version_reported?: number | null;
  schema_version_reported?: number | null;
  last_command?: {
    command_id: string;
    action: string;
    target?: string | number | null;
    status: string;
    error_code?: string | null;
    updated_at?: string | null;
  } | null;
}

/** รูปแบบดิบจาก `GET /api/admin/devices` ของ delivery-server */
export interface RawRegistryDevice {
  device_id: string;
  hardware_model?: string | null;
  schema_version?: number | null;
  status?: string;
  config_version_desired?: number | null;
}
