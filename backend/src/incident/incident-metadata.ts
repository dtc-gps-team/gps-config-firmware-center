/**
 * โครงข้อมูล `Incident.metadata` (Json?) — มติที่ประชุม #32 (docs/07 §9.5 Q2)
 *
 * Incident สร้างได้ 2 ทางที่ต้อง shape เดียวกัน:
 *   - config-sync-writer (ฝั่ง A) — เขียน Config เข้า data กลางไม่สำเร็จ
 *   - Mobile Simulator Test (ฝั่ง B, Phase 5) — ช่างเทสต์อุปกรณ์หน้างานไม่ผ่าน
 *
 * ทุก key optional — ใส่เท่าที่ source นั้นมี · FK ที่ schema มีอยู่แล้ว
 * (`relatedConfigId` / `relatedFirmwareId`) ใช้ผูก relation ตามปกติ **ไม่ต้อง
 * ซ้ำ** ใน metadata (metadata เก็บเฉพาะส่วนที่ไม่มี column จริง)
 *
 * ยังไม่มี incident module จริงในโค้ด (Sprint Checklist แถว 28) — ไฟล์นี้เปิด
 * โฟลเดอร์ `src/incident/` ไว้ให้ type ร่วมมาก่อน · schema `Incident.source` +
 * `Incident.metadata` เพิ่มใน migration `20260910021212_add_incident_source_metadata`
 */
export interface IncidentMetadata {
  configId?: string;
  versionNumber?: number;
  firmwareId?: string;
  /** ตัวระบุกล่องในระบบเดิม (ถ้ามี — เช่น ผล fan-out รายกล่องของ handoff) */
  deviceIdentifier?: string;
  /** จำนวนครั้งที่ retry ก่อนยอมแพ้ */
  attempts?: number;
  /** ข้อความ error ล่าสุดจากความพยายามเขียนครั้งท้าย */
  lastError?: string;
  /** ผลเช็คแบบมีโครงสร้าง (เช่น configCheck/connectionCheck ของ Mobile Simulator Test) */
  checkResults?: unknown;

  // ---- source `rollout-failure` (docs/19 §15.3) ----
  /** `CampaignRollout.id` — 1 Rollout มีได้ 1 Incident ใช้เป็นกุญแจหา Incident เดิม */
  rolloutId?: string;
  campaignId?: string;
  /** `auto-pause` | `completed-with-failures` | `completed-with-skipped` */
  kind?: string;
  failureCount?: number;
  /** เครื่องที่ถูกข้ามเพราะออฟไลน์ (docs/19 §16) */
  skippedCount?: number;
  targetCount?: number;
  /** ไม่เกิน 20 เครื่อง */
  failedDeviceIds?: string[];
  /** ไม่เกิน 3 รายการ */
  sampleErrors?: string[];
}

/**
 * ค่า `Incident.source` ที่ระบบรู้จัก — schema เก็บเป็น free string (`String?`)
 * const นี้ไว้กันพิมพ์ผิดตอนเขียน/กรอง ไม่ได้บังคับที่ DB
 */
export const INCIDENT_SOURCE = {
  configSyncWriter: 'config-sync-writer',
  mobileSimulatorTest: 'mobile-simulator-test',
  // เพิ่มใหม่ (issue #236) — ST/OT แจ้งปัญหาที่เจอกับอุปกรณ์เองผ่าน Mobile
  // (ไม่ใช่ auto-detect เหมือน 2 ค่าข้างบน) ดู `createFieldReport()`
  fieldReport: 'field-report',
  // เพิ่มใหม่ (docs/19 §15) — Rollout เข้า Auto Pause หรือจบแต่มีเครื่องที่ไม่สำเร็จ
  // / ถูกข้ามเพราะออฟไลน์ สร้างอัตโนมัติ 1 Incident ต่อ 1 Rollout
  rolloutFailure: 'rollout-failure',
} as const;

export type IncidentSource =
  (typeof INCIDENT_SOURCE)[keyof typeof INCIDENT_SOURCE];
