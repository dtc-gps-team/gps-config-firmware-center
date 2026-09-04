import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import {
  CONFIG_APPLIER,
  type ConfigApplier,
  MockConfigApplier,
} from './config-applier';
import {
  DEVICE_CONNECTION_TESTER,
  type DeviceConnectionTester,
  MockDeviceConnectionTester,
} from './device-connection-tester';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

// Device module — `POST /devices/:deviceId/test-connection` (ดู device.controller.ts
// สำหรับเหตุผลที่ยังไม่ทำ `GET /devices/:deviceId/status`)
@Module({
  imports: [AuthModule],
  controllers: [DeviceController],
  providers: [
    DeviceService,
    // DEVICE_CONNECTION_TESTER: อ่านโหมดจาก env `DEVICE_CONNECTION_TEST_MODE`
    // (`mock` default | `real`) ตาม Mock Mode Pattern ใน CLAUDE.md —
    // **แยกจาก `DEVICE_SIMULATOR_MODE` โดยตั้งใจ** เป็นคนละ capability กัน
    // (mock/real ของแต่ละอันอาจ progress คนละจังหวะ) โครงเดียวกับ
    // `config.module.ts` (useFactory + NestConfigService) — `real` ยัง throw
    // ตอน startup เพราะยังไม่มี implementation จริง
    {
      provide: DEVICE_CONNECTION_TESTER,
      useFactory: (nestConfig: NestConfigService): DeviceConnectionTester => {
        const mode = nestConfig.get<string>(
          'DEVICE_CONNECTION_TEST_MODE',
          'mock',
        );
        if (mode === 'real') {
          throw new Error(
            'DEVICE_CONNECTION_TEST_MODE=real ยังไม่รองรับ (ยังไม่มีตัวทดสอบสัญญาณอุปกรณ์จริงให้เชื่อม)',
          );
        }
        return new MockDeviceConnectionTester();
      },
      inject: [NestConfigService],
    },
    // CONFIG_APPLIER: env `DEVICE_CONFIG_APPLY_MODE` (`mock` default | `real`)
    // — kittiphong (B) เสนอ reuse `DEVICE_SIMULATOR_MODE` แต่เลือก env แยกตาม
    // แพทเทิร์นในโมดูลนี้เอง (`DEVICE_CONNECTION_TEST_MODE` ก็แยก — mock/real
    // ของแต่ละ capability progress คนละจังหวะ) ถ้าทีมอยาก reuse เปลี่ยน
    // บรรทัดเดียว · `real` ยัง throw เพราะยังไม่มีช่องทางเขียน Config เข้ากล่อง
    // จริง (ดู config-applier.ts + config-sync-writer #32)
    {
      provide: CONFIG_APPLIER,
      useFactory: (nestConfig: NestConfigService): ConfigApplier => {
        const mode = nestConfig.get<string>('DEVICE_CONFIG_APPLY_MODE', 'mock');
        if (mode === 'real') {
          throw new Error(
            'DEVICE_CONFIG_APPLY_MODE=real ยังไม่รองรับ (ยังไม่มีช่องทางเขียน Config เข้าอุปกรณ์จริง — ดู config-sync-writer #32)',
          );
        }
        return new MockConfigApplier();
      },
      inject: [NestConfigService],
    },
  ],
  exports: [DeviceService],
})
export class DeviceModule {}
