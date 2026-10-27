import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import {
  CONFIG_APPLY_MODE,
  type ConfigApplyMode,
  resolveConfigApplyMode,
} from '../device/config-applier';
import {
  CENTRAL_DEVICE_CLIENT,
  type CentralDeviceClient,
  HttpCentralDeviceClient,
  MockCentralDeviceClient,
} from './central-device.client';
import { CentralDeviceController } from './central-device.controller';
import { CentralDeviceService } from './central-device.service';

const DEFAULT_TIMEOUT_MS = 5000;

// Central Device module — อ่านสถานะกล่องจาก ESP32 Central Management ของพี่เลี้ยง (อ่านอย่างเดียว)
// env `CENTRAL_MODE` (`mock` default | `real`) ตาม Mock Mode Pattern ใน CLAUDE.md
// `real` ต้องตั้ง CENTRAL_BASE_URL / CENTRAL_ADMIN_USERNAME / CENTRAL_ADMIN_PASSWORD
// ไม่ครบจะ throw ตอน startup (ไม่แอบถอยไป mock)
@Module({
  imports: [AuthModule],
  controllers: [CentralDeviceController],
  providers: [
    CentralDeviceService,
    {
      provide: CENTRAL_DEVICE_CLIENT,
      useFactory: (nestConfig: NestConfigService): CentralDeviceClient => {
        const mode = nestConfig.get<string>('CENTRAL_MODE', 'mock');
        if (mode !== 'real') return new MockCentralDeviceClient();

        const baseUrl = nestConfig.get<string>('CENTRAL_BASE_URL');
        const username = nestConfig.get<string>('CENTRAL_ADMIN_USERNAME');
        const password = nestConfig.get<string>('CENTRAL_ADMIN_PASSWORD');
        if (!baseUrl || !username || !password) {
          throw new Error(
            'CENTRAL_MODE=real ต้องตั้ง CENTRAL_BASE_URL, CENTRAL_ADMIN_USERNAME และ CENTRAL_ADMIN_PASSWORD',
          );
        }
        const timeoutMs = Number(
          nestConfig.get<string>(
            'CENTRAL_TIMEOUT_MS',
            String(DEFAULT_TIMEOUT_MS),
          ),
        );
        return new HttpCentralDeviceClient({
          baseUrl,
          username,
          password,
          timeoutMs:
            Number.isFinite(timeoutMs) && timeoutMs > 0
              ? timeoutMs
              : DEFAULT_TIMEOUT_MS,
        });
      },
      inject: [NestConfigService],
    },
    // CONFIG_APPLY_MODE: `GET /central/status` คืน `applyMode` (docs/27 §5.6) —
    // provider เดียวกับใน campaign/device/config-apply-request (env
    // `DEVICE_CONFIG_APPLY_MODE`) ประกาศซ้ำแทนการ import DeviceModule (DeviceModule
    // พึ่งโมดูลนี้อยู่แล้ว)
    {
      provide: CONFIG_APPLY_MODE,
      useFactory: (nestConfig: NestConfigService): ConfigApplyMode =>
        resolveConfigApplyMode(
          nestConfig.get<string>('DEVICE_CONFIG_APPLY_MODE'),
        ),
      inject: [NestConfigService],
    },
  ],
  exports: [CentralDeviceService],
})
export class CentralDeviceModule {}
