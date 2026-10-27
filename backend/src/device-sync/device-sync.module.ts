import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { CampaignModule } from '../campaign/campaign.module';
import { DeviceSyncController } from './device-sync.controller';
import { DeviceSyncService } from './device-sync.service';
import { DeviceTelemetryRetentionJob } from './device-telemetry-retention.job';
import { DeviceTelemetryController } from './device-telemetry.controller';
import { DeviceTelemetryService } from './device-telemetry.service';
import { TelemetryKeyGuard } from './telemetry-key.guard';
import { TelemetryRateLimitGuard } from './telemetry-rate-limit.guard';
import {
  resolveTelemetrySettings,
  TELEMETRY_SETTINGS,
} from './telemetry-settings';

// device-sync module (docs/19) — ฝั่งที่อุปกรณ์ดึงงานเองและรายงานผล
// imports CampaignModule: reuse `CampaignRolloutService.recordTargetResult()`
// (ที่ `CampaignModule` export ไว้ให้ `DeviceModule` ใช้อยู่แล้ว) นับผล / Auto
// Pause / ปิด Rollout ทิศทางเดียว ไม่วนกลับ · PrismaService มาจาก PrismaModule
// (@Global) `DeviceApiKeyGuard` ใช้แค่ PrismaService จึงไม่ต้อง import AuthModule
//
// docs/23 — กล่องส่ง GPS telemetry/event เข้ามาเองผ่าน `DeviceTelemetryController`
// (key ใน path, ค่าตั้งจาก env `TELEMETRY_*` อ่านครั้งเดียวตอนเริ่มแอป)
@Module({
  imports: [CampaignModule],
  controllers: [DeviceSyncController, DeviceTelemetryController],
  providers: [
    DeviceSyncService,
    DeviceTelemetryService,
    DeviceTelemetryRetentionJob,
    TelemetryKeyGuard,
    TelemetryRateLimitGuard,
    {
      provide: TELEMETRY_SETTINGS,
      useFactory: (nestConfig: NestConfigService) =>
        resolveTelemetrySettings((key) => nestConfig.get<string>(key)),
      inject: [NestConfigService],
    },
  ],
})
export class DeviceSyncModule {}
