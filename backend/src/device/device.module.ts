import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
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
  ],
  exports: [DeviceService],
})
export class DeviceModule {}
