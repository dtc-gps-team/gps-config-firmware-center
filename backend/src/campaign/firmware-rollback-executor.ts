import { Injectable } from '@nestjs/common';

/**
 * ผลของการ "สั่งอุปกรณ์สลับพาร์ทิชัน" ตอน Rollback Firmware (Incident &
 * Rollback #28, Dual Partition mock — mirror `ConfigApplyResult` ใน
 * `config-applier.ts` ทุกประการ)
 *
 * **ต่างจาก Config Rollback โดยตั้งใจ** — Config ต้องส่งค่าทั้งชุดใหม่เสมอ
 * (ไม่มี concept "ของเก่ายังอยู่") ส่วน Firmware ใช้ Dual Partition
 * (GPS_Config_Firmware_Center_Design.pdf §11.3 — "ควรกำหนด Rollback Target
 * ล่วงหน้า และใช้ Dual Partition เมื่ออุปกรณ์รองรับ") กล่องเก็บ Firmware ไว้ 2
 * ชุดพร้อมกัน Rollback จึงเป็นแค่ "สลับกลับไปพาร์ทิชันที่มีของเก่าอยู่แล้ว"
 * ไม่ต้องส่งข้อมูลใหม่ทั้งชุดเหมือน Config — เร็วกว่ามากในทางทฤษฎี
 */
export interface FirmwarePartitionSwitchResult {
  switched: boolean;
  details: string[];
  /** ISO 8601 — เวลาที่ server สั่งสลับ (ไม่ใช่เวลาที่กล่องสลับจริง — เหมือน
   * `ConfigApplyResult.appliedAt`) */
  switchedAt: string;
}

/** ข้อมูลเท่าที่ตัว Executor ต้องรู้ — deviceId มาจาก `Device.deviceId` เสมอ
 * (mirror `ApplicableConfig`) */
export interface FirmwareRollbackTarget {
  deviceId: string;
  /** พาร์ทิชันที่ active อยู่ตอนนี้ — ต้องสลับไปฝั่งตรงข้าม */
  activePartition: 'A' | 'B';
  /** Firmware id ที่อยู่บนพาร์ทิชันตรงข้าม (ฝั่งที่ไม่ active) — ถ้าไม่ตรงกับ
   * `targetFirmwareId` ที่ต้องการ rollback ไป แปลว่า "ของเก่าไม่อยู่แล้ว"
   * (เช่นเคย rollback ไปแล้วรอบหนึ่ง หรือไม่เคยมีการติดตั้งมาก่อนเลย) */
  inactivePartitionFirmwareId: string | null;
  /** Firmware id ที่ต้องการ rollback ไปหา (มาจาก rollout ก่อนหน้าที่จะ
   * rollback กลับไป) */
  targetFirmwareId: string;
}

/**
 * แยก Interface จาก Implementation ตาม Build Reference §4.3 เหมือน
 * `ConfigApplier`/`DeviceSimulator`/`DeviceConnectionTester` — วันไหนมี
 * ช่องทางสั่งกล่องสลับพาร์ทิชันจริง ค่อยเพิ่ม Implementation ใหม่ `implements
 * FirmwareRollbackExecutor` แล้วสลับ provider ใน `campaign.module.ts` ไม่ต้อง
 * แก้ `CampaignRolloutService` เลย
 *
 * **อยู่ใน `campaign/` ไม่ใช่ `device/` โดยตั้งใจ** (แก้ไข 2026-09-24) — ใช้
 * เฉพาะใน `CampaignRolloutService.approve()`/`.rollback()` ตอนตัดสิน Firmware
 * Rollback เท่านั้น ถ้าไปอยู่ `device/` แล้ว `CampaignModule` ต้อง import
 * `DeviceModule` กลับ จะเกิด circular dependency เพราะ `DeviceModule` import
 * `CampaignModule` อยู่แล้ว (เอาไว้เรียก `recordTargetResult`)
 */
export interface FirmwareRollbackExecutor {
  switchPartition: (
    target: FirmwareRollbackTarget,
  ) => Promise<FirmwarePartitionSwitchResult>;
}

/** DI token — interface ล้วนเป็น token ไม่ได้ (erase ตอน compile) */
export const FIRMWARE_ROLLBACK_EXECUTOR = Symbol('FIRMWARE_ROLLBACK_EXECUTOR');

/**
 * Mock implementation — ยังไม่มีช่องทางสั่งกล่องสลับพาร์ทิชันจริง (สถานะ
 * เดียวกับ `MockConfigApplier`/`MockDeviceSimulator`) — สลับสำเร็จก็ต่อเมื่อ
 * `inactivePartitionFirmwareId` ตรงกับ `targetFirmwareId` จริง (จำลองว่า "ของ
 * เก่ายังอยู่บนอีกพาร์ทิชันไหม") ถ้าไม่ตรง (เช่นถูกเขียนทับไปแล้ว) ให้ fail
 * แบบมีความหมาย ไม่ใช่ success มั่วๆ
 */
@Injectable()
export class MockFirmwareRollbackExecutor implements FirmwareRollbackExecutor {
  switchPartition(
    target: FirmwareRollbackTarget,
  ): Promise<FirmwarePartitionSwitchResult> {
    if (target.inactivePartitionFirmwareId !== target.targetFirmwareId) {
      return Promise.resolve({
        switched: false,
        details: [
          `พาร์ทิชันที่ไม่ active ของ ${target.deviceId} ไม่มี Firmware ${target.targetFirmwareId} อยู่ (mock) — สลับกลับไม่ได้`,
        ],
        switchedAt: new Date().toISOString(),
      });
    }

    const nextPartition = target.activePartition === 'A' ? 'B' : 'A';
    return Promise.resolve({
      switched: true,
      details: [
        `สลับ ${target.deviceId} จากพาร์ทิชัน ${target.activePartition} ไป ${nextPartition} แล้ว (mock) — ไม่ต้องส่งข้อมูลใหม่เพราะ Firmware เดิมยังอยู่บนพาร์ทิชันนั้น`,
      ],
      switchedAt: new Date().toISOString(),
    });
  }
}
