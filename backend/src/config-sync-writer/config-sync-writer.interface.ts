/**
 * config-sync-writer — เขียน Config / Firmware pointer ที่อนุมัติแล้วเข้า "data
 * กลาง" ของระบบเดิม (`config.dtc.co.th:909`) · งานร่วม A+B (Critical Infra —
 * CLAUDE.md ห้ามแก้เดี่ยว) · ดู `docs/07_ConfigSyncWriter_Proposal.md`
 *
 * **ขอบเขต A+B = interface + `mock` implementation เท่านั้น** · `docker` /
 * `production` เป็น handoff (รอ TBD คำสั่ง Write ระบบเดิม + เครื่องทดสอบ DTC +
 * ไฟเขียวทีม — มติที่ประชุม #32, docs/07 §9.5 Q4)
 *
 * shape ตามมติที่ประชุม #32 (docs/07 §9.5 Q1): **ไม่มี `deviceIdentifier`** —
 * Config ไม่ผูกกับ device (เป็นของ deviceModel/protocol) · job ตอน approve รู้
 * แค่ `configId` เดียว · การ fan-out ไปเขียนรายกล่องขึ้นกับว่าคำสั่ง Write ระบบ
 * เดิมเป็น per-box หรือ per-model (TBD §8) → เป็นงาน handoff
 */

/** ข้อมูลที่ writer ต้องใช้ประกอบคำสั่งเขียน Config 1 เวอร์ชัน */
export interface LegacyConfigWrite {
  /** เวอร์ชันที่ Operation อนุมัติ — ไว้ log / ตรวจสอบย้อนหลัง */
  configId: string;
  versionNumber: number;
  deviceModel: string;
  protocol: string;
  /** ค่าที่จะเขียน — snapshot จาก `ConfigVersion.fields` (key = ชื่อ field ตามระบบเดิม) */
  fields: Record<string, string | number>;
}

/**
 * Firmware pointer write — **TBD Phase 3** (firmware pointer sync ยังไม่ทำ)
 * shape ตั้งต้นเท่าที่พอเดาได้ · นิยามจริงตอนทำ `writeFirmwarePointerToLegacySystem`
 * ใน Phase 3 (ดู `docs/planning/03_GPS_Detailed_Build_Steps.md` Phase 3 ข้อ 3)
 */
export interface LegacyFirmwarePointerWrite {
  firmwareId: string;
  version: string;
  deviceModel: string;
}

export interface ConfigSyncWriter {
  // property-function type (ไม่ใช่ method shorthand) — กัน
  // @typescript-eslint/unbound-method ตอนเทสอ้าง `writer.writeConfigToLegacySystem`
  // ตรงๆ · pattern เดียวกับ `ConfigApplier` / `DeviceConnectionTester`
  //
  // โยน error ถ้าเขียนไม่สำเร็จ — ให้ชั้น background job (งานร่วม A+B — PR ถัดไป)
  // จับไป retry / สร้าง Incident (`source: 'config-sync-writer'`)
  writeConfigToLegacySystem: (input: LegacyConfigWrite) => Promise<void>;
  writeFirmwarePointerToLegacySystem: (
    input: LegacyFirmwarePointerWrite,
  ) => Promise<void>;
}

/** DI token — interface ล้วนเป็น token ไม่ได้ (erase ตอน compile) */
export const CONFIG_SYNC_WRITER = Symbol('CONFIG_SYNC_WRITER');

/** ค่าที่ env `LEGACY_SYNC_MODE` รับได้ (ดู `.env.example`) */
export const LEGACY_SYNC_MODES = ['mock', 'docker', 'production'] as const;
export type LegacySyncMode = (typeof LEGACY_SYNC_MODES)[number];
