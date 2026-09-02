import { Injectable } from '@nestjs/common';

/**
 * ผลทดสอบการเชื่อมต่อของอุปกรณ์ที่ติดตั้งจริง — ตรงกับ schema
 * `DeviceConnectionTestResult` ใน docs/api/openapi.yaml (`testDeviceConnection`)
 *
 * ต่างจาก `SimulationResult` (config/device-simulator.ts) ตรงที่มี
 * `signalStrength` + `testedAt` — เพราะอันนี้คือ "ทดสอบสัญญาณอุปกรณ์เครื่องนั้น"
 * ไม่ใช่ dry-run ตรวจค่า field ใน Config template (ดู
 * docs/06_Device_Connection_Test_Spec.md — spec ตกลงกับ paveekornkwork-dev
 * บนคอมเมนต์ PR #52)
 */
export interface DeviceConnectionTestResult {
  passed: boolean;
  signalStrength: number;
  details: string[];
  /** ISO 8601 */
  testedAt: string;
}

/** ข้อมูล Device เท่าที่ตัว Tester ต้องรู้ — ตั้งใจไม่รับ `Device` (Prisma
 * entity) ทั้งตัว เพื่อให้ mock/เทสสร้าง fixture ได้ง่าย (เหมือน
 * `SimulatableConfig` ใน device-simulator.ts) */
export interface TestableDevice {
  deviceId: string;
  deviceModel: string;
  protocol: string;
}

/**
 * แยก Interface จาก Implementation ตามหลัก Build Reference §4.3
 * (Extensibility) แบบเดียวกับ `DeviceSimulator` — วันไหนมีตัวยิงสัญญาณจริง
 * ค่อยเพิ่ม Implementation ใหม่ `implements DeviceConnectionTester` แล้วสลับ
 * provider ใน `device.module.ts` — ไม่ต้องแก้ `DeviceService`
 */
export interface DeviceConnectionTester {
  // property function type (ไม่ใช่ method shorthand) — เหตุผลเดียวกับ
  // `DeviceSimulator.simulateConfig` (กัน `@typescript-eslint/unbound-method`
  // ตอนเทสอ้าง `tester.testConnection` ตรงๆ)
  testConnection: (
    device: TestableDevice,
  ) => Promise<DeviceConnectionTestResult>;
}

/** DI token — interface ล้วนเป็น token ไม่ได้ (erase ตอน compile) */
export const DEVICE_CONNECTION_TESTER = Symbol('DEVICE_CONNECTION_TESTER');

/** ค่า signalStrength คงที่ที่ mock คืนกลับเสมอ (dBm) — A ยืนยันบน PR #52
 * ว่า Mobile ต้องมีตัวเลขนี้ไปทำ/ทดสอบ UI ได้ตั้งแต่ mock mode (layout,
 * การแสดงผลค่าติดลบ, เกณฑ์สี ฯลฯ) ไม่ต้องรอ real implementation */
const MOCK_SIGNAL_STRENGTH_DBM = -65;

/**
 * Mock implementation — ยังไม่มีตัวยิงสัญญาณไปอุปกรณ์จริง (สถานะเดียวกับ
 * `MockDeviceSimulator` และ `config-sync-writer` ใน Phase 2) — คืน `passed: true`
 * เสมอพร้อม `signalStrength` คงที่ ระบุใน `details` ชัดว่าเป็น mock
 */
@Injectable()
export class MockDeviceConnectionTester implements DeviceConnectionTester {
  testConnection(device: TestableDevice): Promise<DeviceConnectionTestResult> {
    return Promise.resolve({
      passed: true,
      signalStrength: MOCK_SIGNAL_STRENGTH_DBM,
      details: [
        `ทดสอบผ่าน — ${device.deviceId} (${device.deviceModel}/${device.protocol}) RSSI ${MOCK_SIGNAL_STRENGTH_DBM} dBm (mock, ยังไม่เชื่อมอุปกรณ์จริง)`,
      ],
      testedAt: new Date().toISOString(),
    });
  }
}
