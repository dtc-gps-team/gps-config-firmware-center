import { Injectable } from '@nestjs/common';
import { ConfigStatus } from '@prisma/client';

/**
 * ผลของการ "ใส่ Config ให้อุปกรณ์ที่ติดตั้งจริง" — ตรงกับ schema
 * `ConfigApplyResult` ใน docs/api/openapi.yaml (`applyConfigToDevice`)
 *
 * **ไม่มี field สถานะอุปกรณ์หลัง apply** โดยตั้งใจ — กล่องเช็ค Config ของตัวเอง
 * ตอน **เปิดเครื่องครั้งถัดไป** เท่านั้น (01_GPS_Build_Reference.md §4.2)
 * ไม่มีสถานะ synchronous ให้คืน ถ้าใส่ไปจะทำให้ Mobile เข้าใจผิด (ยืนยันกับ
 * kittiphong (B) 2026-09 — ผู้ใช้ endpoint นี้ฝั่ง Mobile)
 */
export interface ConfigApplyResult {
  applied: boolean;
  details: string[];
  /** ISO 8601 — เวลาที่ server รับคำสั่ง apply (ไม่ใช่เวลาที่กล่องรับจริง) */
  appliedAt: string;
}

/** ข้อมูลเท่าที่ตัว Applier ต้องรู้ — deviceModel/protocol ถูก validate ที่
 * `DeviceService` แล้วว่าตรงกับ Config เดียวกัน จึงส่งชุดเดียวพอ (แนวเดียวกับ
 * `SimulatableConfig` / `TestableDevice`) */
export interface ApplicableConfig {
  deviceId: string;
  deviceModel: string;
  protocol: string;
  fields: Record<string, unknown>;
}

/** สถานะ Config ที่ apply เข้าอุปกรณ์จริงได้ — ต้องผ่าน Operation อนุมัติมาแล้ว
 * เท่านั้น (`approved` = อนุมัติแล้ว, `synced` = เขียนเข้าระบบเดิมแล้ว) — Config
 * ที่ยัง `draft`/`testing`/`rejected` ห้าม apply หน้างาน ตรงกับ 409 ใน openapi */
export const APPLICABLE_CONFIG_STATUSES: readonly ConfigStatus[] = [
  'approved',
  'synced',
];

/**
 * แยก Interface จาก Implementation ตาม Build Reference §4.3 (Extensibility)
 * แบบเดียวกับ `DeviceSimulator` / `DeviceConnectionTester` — วันไหนมีตัวเขียน
 * Config เข้าอุปกรณ์จริง (ผ่าน `config-sync-writer` หรือช่องทางอื่น) ค่อยเพิ่ม
 * Implementation ใหม่ `implements ConfigApplier` แล้วสลับ provider ใน
 * `device.module.ts` — ไม่ต้องแก้ `DeviceService`
 */
export interface ConfigApplier {
  // property function type (ไม่ใช่ method shorthand) — เหตุผลเดียวกับ
  // `DeviceConnectionTester.testConnection` (กัน @typescript-eslint/unbound-method
  // ตอนเทสอ้าง `applier.applyConfig` ตรงๆ)
  applyConfig: (config: ApplicableConfig) => Promise<ConfigApplyResult>;
}

/** DI token — interface ล้วนเป็น token ไม่ได้ (erase ตอน compile) */
export const CONFIG_APPLIER = Symbol('CONFIG_APPLIER');

/** ชื่อฟิลด์ที่ต้องเป็นค่าบวกเสมอถ้ามีอยู่ (Timeout/Interval) — ชุดเดียวกับ
 * `MockDeviceSimulator` (config/device-simulator.ts) จับคู่แบบ case-insensitive
 * substring เพราะยังไม่มีสเปกฟิลด์จริงทั้ง ~262 ตัวมาอ้าง */
const MUST_BE_NON_NEGATIVE_KEY_HINTS = ['TIMEOUT', 'INTERVAL'];

/**
 * Mock implementation — ยังไม่มีช่องทางเขียน Config เข้ากล่องจริง (สถานะ
 * เดียวกับ `MockDeviceSimulator` / `MockDeviceConnectionTester` /
 * `config-sync-writer` ใน Phase 2) ตรวจกฎเบื้องต้นเท่าที่รู้แน่นอนแล้วคืน
 * `applied: true` — ระบุใน `details` ชัดว่าเป็น mock:
 *
 * 1. Config ต้องมีอย่างน้อย 1 field
 * 2. ฟิลด์ Timeout/Interval ต้องไม่ติดลบ
 *
 * (กฎชุดเดียวกับ `MockDeviceSimulator` — apply Config ที่ค่าพวกนี้ผิดไม่ควร
 * สำเร็จ)
 */
@Injectable()
export class MockConfigApplier implements ConfigApplier {
  applyConfig(config: ApplicableConfig): Promise<ConfigApplyResult> {
    const problems: string[] = [];
    const fieldEntries = Object.entries(config.fields ?? {});

    if (fieldEntries.length === 0) {
      problems.push('Config ไม่มี field ใดเลย — ไม่มีอะไรให้ใส่เข้าอุปกรณ์');
    }

    for (const [key, value] of fieldEntries) {
      const looksLikeNonNegativeField = MUST_BE_NON_NEGATIVE_KEY_HINTS.some(
        (hint) => key.toUpperCase().includes(hint),
      );
      if (!looksLikeNonNegativeField) {
        continue;
      }
      const numericValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isNaN(numericValue) && numericValue < 0) {
        problems.push(
          `ฟิลด์ "${key}" เป็นค่า Timeout/Interval ต้องไม่ติดลบ (ได้รับ ${String(value)})`,
        );
      }
    }

    if (problems.length > 0) {
      return Promise.resolve({
        applied: false,
        details: problems,
        appliedAt: new Date().toISOString(),
      });
    }

    return Promise.resolve({
      applied: true,
      details: [
        `ส่ง Config ${fieldEntries.length} ฟิลด์ให้ ${config.deviceId} ` +
          `(${config.deviceModel}/${config.protocol}) แล้ว — mock, ` +
          `กล่องจะรับค่าเมื่อเปิดเครื่องครั้งถัดไป`,
      ],
      appliedAt: new Date().toISOString(),
    });
  }
}
