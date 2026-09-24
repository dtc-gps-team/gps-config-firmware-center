/**
 * โครงข้อมูล `AuditLog.metadata` (Json?) — มติที่ยืนยันไว้ใน issue #205
 * (Approach A, mirror `Incident.metadata` — ดู src/incident/incident-metadata.ts)
 *
 * ทุก key optional — ใส่เท่าที่จุดเขียนนั้นมี ตามเกณฑ์ที่ตกลงไว้: เก็บเฉพาะ
 * event ที่ "สำคัญ/จำเป็นต่อการตรวจสอบ" ไม่ใช่ backfill ทุกจุดที่เขียน
 * AuditLog อยู่แล้วในระบบ (เขียนจาก `DeviceService.applyConfig()` และ
 * `DeviceService.confirmFirmwareInstall()` — issue #181)
 *
 * **ตั้งใจไม่มี key เก็บค่าจริงของ field** (เช่น ค่า Config.fields ทั้งก้อน) —
 * ดู comment เหนือ `AuditLog.metadata` ใน schema.prisma
 */
export interface AuditLogMetadata {
  /** `Device.deviceId` (เลขเครื่องจริง — ไม่ใช่ UUID ภายใน) ของอุปกรณ์ที่ถูก apply/confirm */
  deviceId?: string;
  /** `Config.id` ของ Config ที่ apply เข้าอุปกรณ์ */
  configId?: string;
  /** ชื่อ field (key) ที่มีอยู่ใน Config นั้น ณ ตอน apply — ไม่ใช่ค่าจริง
   * (กันข้อมูลอ่อนไหว เช่น COMMAND_PASSWORD/SOS_NUMBER_1 รั่วผ่าน GET /audit-logs
   * ที่เปิดให้ Operation/ST/OT/Auditor/Admin อ่านได้) */
  fieldNames?: string[];
  /** `Firmware.id` ที่ช่างยืนยันว่าติดตั้งเข้าอุปกรณ์เสร็จแล้ว (issue #181) */
  firmwareId?: string;
  /** `Firmware.version` ณ ตอนยืนยัน — ไม่มีข้อมูลอ่อนไหว ใส่ไว้เพื่อดูง่ายบน
   * `GET /audit-logs` โดยไม่ต้อง join เพิ่ม */
  firmwareVersion?: string;
}
