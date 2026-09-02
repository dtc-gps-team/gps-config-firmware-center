import { Injectable } from '@nestjs/common';

/**
 * ผลทดสอบจาก Device Simulator — ตรงกับ schema `SimulationResult` ใน
 * docs/api/openapi.yaml (`simulateConfig`/`simulateFirmware` ใช้ shape เดียวกัน)
 */
export interface SimulationResult {
  passed: boolean;
  details: string[];
}

/** ข้อมูล Config เท่าที่ Simulator ต้องรู้ — ตั้งใจไม่รับ `Config` (Prisma
 * entity) ทั้งตัวเข้ามาตรงๆ เพื่อให้ mock/เทสสร้าง fixture ได้ง่าย ไม่ต้องผูก
 * กับ field อื่นของ Config ที่ Simulator ไม่ได้ใช้ (id, status, createdBy ฯลฯ) */
export interface SimulatableConfig {
  deviceModel: string;
  protocol: string;
  fields: Record<string, unknown>;
}

/**
 * แยก Interface จาก Implementation ตามหลัก Build Reference §4.3
 * (Extensibility) — วันไหนมี Device Simulator ตัวจริง (เช่น ยิงไปเครื่อง
 * Local/Docker แบบเดียวกับแนวทาง config-sync-writer ใน Phase 2) ค่อยเพิ่ม
 * Implementation ใหม่ `implements DeviceSimulator` แล้วสลับ provider ใน
 * `config.module.ts` — ไม่ต้องแก้ `ConfigService` เพราะเรียกผ่าน interface
 * นี้เท่านั้น (เหมือน `ConfigImporter` ที่ยังไม่ทำจริงใน Stage 2 ด้วยเหตุผล
 * เดียวกัน — YAGNI จนกว่าจะมี Implementation ที่ 2 จริง)
 */
export interface DeviceSimulator {
  // ประกาศเป็น property ที่เป็น function type (ไม่ใช่ method shorthand)
  // ตั้งใจ — method shorthand ทำให้ `@typescript-eslint/unbound-method`
  // ฟ้องตอนเทสอ้างถึง `deviceSimulator.simulateConfig` ตรงๆ (เช่น
  // `expect(deviceSimulator.simulateConfig).toHaveBeenCalledWith(...)`)
  // เพราะมองว่าเป็น method ที่อาจต้องพึ่ง `this` เวลาถูกแยกออกจาก object
  // ของมัน — เปลี่ยนเป็น property function ตัดปัญหานี้ตั้งแต่ระดับ type
  // (implementation ยังเขียนเป็น method shorthand ปกติได้ ตรงกันตาม
  // structural typing ของ TypeScript)
  simulateConfig: (config: SimulatableConfig) => Promise<SimulationResult>;
}

/** DI token — ใช้ interface ล้วนเป็น token ไม่ได้ (erase ตอน compile เป็น JS)
 * ต้องมี token แยกแบบเดียวกับ pattern ทั่วไปของ NestJS */
export const DEVICE_SIMULATOR = Symbol('DEVICE_SIMULATOR');

/** ชื่อฟิลด์ที่รู้แน่นอนว่าต้องเป็นค่าบวกเสมอถ้ามันมีอยู่ในฟิลด์ (ค่า Timeout/
 * Interval) — ตรงกับตัวอย่างใน 03_GPS_Detailed_Build_Steps.md Phase 1 ข้อ 3
 * (Semantic Validation เท่าที่ทำได้) จับคู่แบบ case-insensitive substring
 * เพราะยังไม่มีตาราง Config Definition Lookup (`ConfigFieldDefinition`) ที่รู้
 * ชื่อฟิลด์จริงทั้ง ~262 ตัวในระบบ ณ ตอนนี้ (ดู TODO(Stage 3) ใน
 * `ConfigService.importFromJson`) — วันไหนมีตารางนั้นแล้ว ค่อยย้าย logic นี้
 * ไปตรวจกับ schema ต่อ deviceModel/protocol จริงแทนการเดาจากชื่อฟิลด์ */
const MUST_BE_NON_NEGATIVE_KEY_HINTS = ['TIMEOUT', 'INTERVAL'];

/**
 * Mock implementation — ยังไม่มี Device Simulator จริงให้เชื่อมต่อ (สถานะ
 * เดียวกับ `config-sync-writer` ใน Phase 2 ที่ยัง mock/docker เท่านั้น เพราะ
 * TBD คำสั่ง Write/Set ของระบบเดิมยังไม่ปิด) ตรวจกฎเท่าที่รู้แน่นอนแทนการยิงไป
 * กล่องจริง:
 *
 * 1. Config ต้องมีอย่างน้อย 1 field (ว่างเปล่าไม่มีทางทดสอบผ่านได้จริง)
 * 2. ฟิลด์ที่ชื่อเข้าเงื่อนไข Timeout/Interval ต้องไม่เป็นค่าติดลบ
 *
 * นอกเหนือจากนี้ถือว่าผ่าน — ตั้งใจให้กฎน้อยและตรงไปตรงมา (validation_level:
 * syntactic_only ตามคอมเมนต์ pattern เดียวกับ `config.service.ts`) เพราะยังไม่มี
 * สเปกฟิลด์จริงมาอ้างอิงลึกกว่านี้ได้
 */
@Injectable()
export class MockDeviceSimulator implements DeviceSimulator {
  simulateConfig(config: SimulatableConfig): Promise<SimulationResult> {
    const details: string[] = [];
    const fieldEntries = Object.entries(config.fields ?? {});

    if (fieldEntries.length === 0) {
      details.push(
        'Config ยังไม่มี field ใดเลย — ต้องกรอกอย่างน้อย 1 ฟิลด์ก่อนทดสอบ',
      );
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
        details.push(
          `ฟิลด์ "${key}" เป็นค่า Timeout/Interval ต้องไม่ติดลบ (ได้รับ ${String(value)})`,
        );
      }
    }

    if (details.length > 0) {
      return Promise.resolve({ passed: false, details });
    }

    return Promise.resolve({
      passed: true,
      details: [
        `ทดสอบผ่าน — ${config.deviceModel}/${config.protocol} (mock, ยังไม่เชื่อมกล่องจริง)`,
      ],
    });
  }
}
