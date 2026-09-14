import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';
import { FirmwareStorageService } from './firmware-storage.service';
import {
  FIRMWARE_SIMULATOR,
  type FirmwareSimulator,
  MockFirmwareSimulator,
} from './firmware-simulator';

// Firmware module (ฝั่ง A, Sprint 3 #23) — `POST /firmware` อัปโหลดขึ้น
// Object Storage จริง (MinIO ตอนนี้ → AWS S3 ตอนใช้งานจริง, ไม่มี mock mode
// — ดู comment ใน firmware-storage.service.ts) + `PATCH /firmware/{id}`
// (Compatibility Tag) + `POST /firmware/{id}/simulate` (mock — env
// FIRMWARE_SIMULATOR_MODE)
//
// AuthModule: JwtAuthGuard/JwtModule ร่วม (PermissionGuard resolve เองผ่าน
// PrismaModule @Global + Reflector)
@Module({
  imports: [AuthModule],
  controllers: [FirmwareController],
  providers: [
    FirmwareService,
    FirmwareStorageService,
    // FIRMWARE_SIMULATOR: env `FIRMWARE_SIMULATOR_MODE` (`mock` default |
    // `real`) ตาม Mock Mode Pattern เดียวกับ `DEVICE_SIMULATOR_MODE` —
    // ยังไม่มี Device Simulator ตัวจริงที่ทดสอบ Firmware ได้ ตั้ง `real`
    // ตอนนี้จึงยัง throw ตอน startup
    {
      provide: FIRMWARE_SIMULATOR,
      useFactory: (nestConfig: NestConfigService): FirmwareSimulator => {
        const mode = nestConfig.get<string>('FIRMWARE_SIMULATOR_MODE', 'mock');
        if (mode === 'real') {
          throw new Error(
            'FIRMWARE_SIMULATOR_MODE=real ยังไม่รองรับ (ยังไม่มี Device Simulator ตัวจริงให้เชื่อม)',
          );
        }
        return new MockFirmwareSimulator();
      },
      inject: [NestConfigService],
    },
  ],
  exports: [FirmwareService],
})
export class FirmwareModule {}
