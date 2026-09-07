import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import {
  FCM_SENDER,
  type FcmSender,
  MockFcmSender,
  RealFcmSender,
} from './fcm-sender';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  // JwtModule/JwtAuthGuard ย้ายมารวมที่ AuthModule แล้ว (ตามคอมเมนต์เดิมที่ B ทิ้งไว้)
  // import AuthModule แทนการ JwtModule.register(...) ซ้ำเอง
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    // FCM_SENDER: อ่านโหมดจาก env `NOTIFICATION_MODE` (`mock` default | `fcm`)
    // โครงเดียวกับ `DEVICE_CONNECTION_TESTER` ใน device.module.ts (useFactory +
    // NestConfigService) — `fcm` ต้อง throw ตอน startup ทันทีถ้า
    // `FCM_SERVICE_ACCOUNT_PATH` หาไฟล์ไม่เจอ/parse ไม่ได้ (fail fast ใน
    // `RealFcmSender` constructor) ไม่ปล่อยให้ error โผล่ตอนส่ง push ครั้งแรก
    {
      provide: FCM_SENDER,
      useFactory: (nestConfig: NestConfigService): FcmSender => {
        const mode = nestConfig.get<string>('NOTIFICATION_MODE', 'mock');
        if (mode === 'fcm') {
          const serviceAccountPath = nestConfig.get<string>(
            'FCM_SERVICE_ACCOUNT_PATH',
            '',
          );
          return new RealFcmSender(serviceAccountPath);
        }
        return new MockFcmSender();
      },
      inject: [NestConfigService],
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
