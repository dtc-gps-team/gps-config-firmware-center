/**
 * โครงข้อมูล `AuditLog.metadata` (Json?) — มติที่ยืนยันไว้ใน issue #205
 * (Approach A, mirror `Incident.metadata` — ดู src/incident/incident-metadata.ts)
 *
 * ทุก key optional — ใส่เท่าที่จุดเขียนนั้นมี ตามเกณฑ์ที่ตกลงไว้: เก็บเฉพาะ
 * event ที่ "สำคัญ/จำเป็นต่อการตรวจสอบ" ไม่ใช่ backfill ทุกจุดที่เขียน
 * AuditLog อยู่แล้วในระบบ (รอบนี้เขียนจาก `DeviceService.applyConfig()` เท่านั้น)
 *
 * **ตั้งใจไม่มี key เก็บค่าจริงของ field** (เช่น ค่า Config.fields ทั้งก้อน) —
 * ดู comment เหนือ `AuditLog.metadata` ใน schema.prisma
 */
export interface AuditLogMetadata {
  /** `Device.deviceId` (เลขเครื่องจริง — ไม่ใช่ UUID ภายใน) ของอุปกรณ์ที่ถูก apply */
  deviceId?: string;
  /** `Config.id` ของ Config ที่ apply เข้าอุปกรณ์ */
  configId?: string;
  /** ชื่อ field (key) ที่มีอยู่ใน Config นั้น ณ ตอน apply — ไม่ใช่ค่าจริง
   * (กันข้อมูลอ่อนไหว เช่น COMMAND_PASSWORD/SOS_NUMBER_1 รั่วผ่าน GET /audit-logs
   * ที่เปิดให้ Operation/ST/OT/Auditor/Admin อ่านได้) */
  fieldNames?: string[];
}
