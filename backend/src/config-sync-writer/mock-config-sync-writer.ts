import { Injectable, Logger } from '@nestjs/common';
import {
  ConfigSyncWriter,
  LegacyConfigWrite,
  LegacyFirmwarePointerWrite,
} from './config-sync-writer.interface';

/**
 * Mock implementation — เขียน log แทนการยิง TCP เข้าระบบเดิม (โหมด `mock`,
 * default) · ยังไม่มีช่องทางเขียนจริง (สถานะเดียวกับ `MockConfigApplier` /
 * `MockDeviceSimulator`) · `docker`/`production` เป็น handoff (docs/07 §2)
 *
 * โยน error เฉพาะกรณีที่ "เขียนไม่ได้แน่ๆ" ระดับ input — Config ไม่มี field เลย
 * (ไม่มีอะไรให้เขียน) · เคสนี้ปล่อยให้ throw เพื่อให้ชั้น background job (PR ถัดไป)
 * retry แล้วสร้าง Incident ตาม flow จริง ไม่ใช่ให้ผ่านเงียบๆ
 */
@Injectable()
export class MockConfigSyncWriter implements ConfigSyncWriter {
  private readonly logger = new Logger(MockConfigSyncWriter.name);

  writeConfigToLegacySystem(input: LegacyConfigWrite): Promise<void> {
    const fieldCount = Object.keys(input.fields ?? {}).length;
    if (fieldCount === 0) {
      return Promise.reject(
        new Error(
          `config ${input.configId} v${input.versionNumber} ไม่มี field ใดเลย — ไม่มีอะไรให้เขียนเข้า data กลาง`,
        ),
      );
    }

    this.logger.log(
      `[mock] เขียน config ${input.configId} v${input.versionNumber} ` +
        `(${input.deviceModel}/${input.protocol}) เข้า config.dtc.co.th:909 — ${fieldCount} field`,
    );
    return Promise.resolve();
  }

  writeFirmwarePointerToLegacySystem(
    input: LegacyFirmwarePointerWrite,
  ): Promise<void> {
    // Phase 3 — ยังไม่มี firmware pointer sync จริง (ดู interface)
    this.logger.log(
      `[mock] เขียน firmware pointer ${input.firmwareId} (${input.version}, ` +
        `${input.deviceModel}) เข้า config.dtc.co.th:909`,
    );
    return Promise.resolve();
  }
}
