import type { SimulationResult } from '../config/device-simulator';
import type { DeviceConnectionTestResult } from './device-connection-tester';

/**
 * ผลเช็คว่า `Config.deviceModel`/`Config.protocol` ตรงกับอุปกรณ์เครื่องนี้ไหม
 *
 * ต่างจาก `applyConfigToDevice` ที่ deviceModel/protocol mismatch = 409 (hard
 * block เพราะ endpoint นั้นเขียนค่าจริง) — endpoint นี้เป็น dry-run สำหรับช่าง
 * ดูก่อนกด apply จริง จึง **report ผลกลับไปเป็น 200** ให้เห็นชัดว่าตรงไหนไม่ผ่าน
 */
export interface CompatibilityCheckResult {
  passed: boolean;
  details: string[];
}

/**
 * ผลรวม readiness check ของ Config บนอุปกรณ์เครื่องหนึ่ง
 * (`simulateConfigOnDevice`) — 3 ส่วนรวมเป็นผลเดียว ไม่มีส่วนไหนเป็น `null`
 * เพราะ endpoint บังคับส่งทั้ง `deviceId` (path) และ `configId` (body) เสมอ
 *
 * แยก schema จาก `SimulationResult` เดิมโดยตั้งใจ — `SimulationResult` ใช้ร่วม
 * กับ Web Config Editor dry-run (`POST /config/{id}/simulate`) ซึ่งเช็คแค่ตัว
 * Config เองล้วนๆ (ตกลงกับ kittiphong (B) บน PR #92)
 */
export interface DeviceSimulateConfigResult {
  /** true เมื่อ configCheck, compatibilityCheck, connectionCheck ผ่านทั้งหมด */
  passed: boolean;
  /** ตัว Config เองพร้อมไหม — ผลจาก DeviceSimulator (เหมือน `/config/{id}/simulate`) */
  configCheck: SimulationResult;
  /** deviceModel/protocol ของ Config ตรงกับอุปกรณ์เครื่องนี้ไหม */
  compatibilityCheck: CompatibilityCheckResult;
  /** สัญญาณของกล่องเครื่องนั้น — ผลจาก DeviceConnectionTester (เหมือน `/test-connection`) */
  connectionCheck: DeviceConnectionTestResult;
}
