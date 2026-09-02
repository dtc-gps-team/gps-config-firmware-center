import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import {
  DEVICE_SIMULATOR,
  type DeviceSimulator,
  MockDeviceSimulator,
} from './device-simulator';

// ชื่อ module นี้ (ConfigController/ConfigService/ConfigModule) ชนกับชื่อ
// ConfigModule ของ @nestjs/config ที่ import อยู่ใน app.module.ts อยู่แล้ว —
// ไม่ได้ลบ/เปลี่ยนชื่อ business module นี้ (ตั้งชื่อตาม Prisma model `Config`
// และ path `/config` ที่มีอยู่แล้วทุกที่) แต่ alias import ของ @nestjs/config
// เป็น NestConfigModule แทนที่ app.module.ts — ดู comment ที่นั่น
@Module({
  imports: [AuthModule],
  controllers: [ConfigController],
  providers: [
    ConfigService,
    // DEVICE_SIMULATOR: อ่านโหมดจาก env `DEVICE_SIMULATOR_MODE` (`mock`
    // default | `real`) ตาม convention ใน CLAUDE.md § Mock Mode Pattern
    // เดียวกับ `NOTIFICATION_MODE`/`LEGACY_SYNC_MODE` (ห้ามคิด pattern ใหม่ —
    // ก่อนหน้านี้ผูก useClass ตรงๆ ไม่ผ่าน env เลย แก้ตาม code review ของ
    // kittiphong บน PR Stage 3) — ยังไม่มี Real implementation ให้เชื่อมจริง
    // (ดูเหตุผลเต็มใน device-simulator.ts) ตั้ง `real` ตอนนี้จึงยัง throw
    // ตอน startup อยู่ ต้องรอวันที่มี Implementation จริงมาสลับใน factory นี้
    {
      provide: DEVICE_SIMULATOR,
      useFactory: (nestConfig: NestConfigService): DeviceSimulator => {
        const mode = nestConfig.get<string>('DEVICE_SIMULATOR_MODE', 'mock');
        if (mode === 'real') {
          throw new Error(
            'DEVICE_SIMULATOR_MODE=real ยังไม่รองรับ (ยังไม่มี Device Simulator ตัวจริงให้เชื่อม)',
          );
        }
        return new MockDeviceSimulator();
      },
      inject: [NestConfigService],
    },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
