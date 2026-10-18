import { Module } from '@nestjs/common';
import { CampaignModule } from '../campaign/campaign.module';
import { DeviceSyncController } from './device-sync.controller';
import { DeviceSyncService } from './device-sync.service';

// device-sync module (docs/19) — ฝั่งที่อุปกรณ์ดึงงานเองและรายงานผล
// imports CampaignModule: reuse `CampaignRolloutService.recordTargetResult()`
// (ที่ `CampaignModule` export ไว้ให้ `DeviceModule` ใช้อยู่แล้ว) นับผล / Auto
// Pause / ปิด Rollout ทิศทางเดียว ไม่วนกลับ · PrismaService มาจาก PrismaModule
// (@Global) `DeviceApiKeyGuard` ใช้แค่ PrismaService จึงไม่ต้อง import AuthModule
@Module({
  imports: [CampaignModule],
  controllers: [DeviceSyncController],
  providers: [DeviceSyncService],
})
export class DeviceSyncModule {}
