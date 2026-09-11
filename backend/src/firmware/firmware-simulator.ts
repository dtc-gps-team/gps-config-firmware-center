import { Injectable } from '@nestjs/common';
import type { SimulationResult } from '../config/device-simulator';

export type { SimulationResult };

/** ข้อมูลเท่าที่ Simulator ต้องรู้ — ไม่รับ `Firmware` (Prisma entity) ทั้งตัว
 * เข้ามาตรงๆ (เหตุผลเดียวกับ `SimulatableConfig`) */
export interface SimulatableFirmware {
  deviceModel: string;
  deviceModelCompatibility: string[];
}

/**
 * แยก Interface จาก Implementation ตาม Build Reference §4.3 (Extensibility)
 * — pattern เดียวกับ `DeviceSimulator`/`DeviceConnectionTester`/
 * `ConfigApplier` วันไหนมี Device Simulator ตัวจริงที่ทดสอบ Firmware ได้
 * (ยิงไปเครื่อง Local/Docker) ค่อยเพิ่ม Implementation ใหม่แล้วสลับ provider
 * ใน `firmware.module.ts` — ไม่ต้องแก้ `FirmwareService`
 */
export interface FirmwareSimulator {
  simulateFirmware: (
    firmware: SimulatableFirmware,
  ) => Promise<SimulationResult>;
}

export const FIRMWARE_SIMULATOR = Symbol('FIRMWARE_SIMULATOR');

/**
 * Mock implementation — ยังไม่มี Device Simulator ตัวจริงที่ทดสอบ Firmware
 * ได้ (สถานะเดียวกับ `MockDeviceSimulator`) ตรวจกฎเดียวที่รู้แน่นอน: รุ่น
 * อุปกรณ์ที่จะทดสอบต้องอยู่ใน `deviceModelCompatibility` ที่แท็กไว้ — ไม่มี
 * การตรวจเนื้อหาไฟล์จริง (ยังไม่เชื่อมกล่องจริง)
 */
@Injectable()
export class MockFirmwareSimulator implements FirmwareSimulator {
  simulateFirmware(firmware: SimulatableFirmware): Promise<SimulationResult> {
    if (!firmware.deviceModelCompatibility.includes(firmware.deviceModel)) {
      return Promise.resolve({
        passed: false,
        details: [
          `Firmware นี้ไม่ได้แท็กว่ารองรับรุ่น ${firmware.deviceModel} (รองรับ: ${firmware.deviceModelCompatibility.join(', ') || '-'})`,
        ],
      });
    }

    return Promise.resolve({
      passed: true,
      details: [
        `ทดสอบผ่าน — รองรับรุ่น ${firmware.deviceModel} (mock, ยังไม่เชื่อมกล่องจริง)`,
      ],
    });
  }
}
