import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignController } from './campaign.controller';
import { CampaignRolloutController } from './campaign-rollout.controller';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CampaignService } from './campaign.service';

// Campaign module (ฝั่ง A, Sprint 3 #21/#22) — `POST /campaigns` สร้างกลุ่ม
// อุปกรณ์ (`CampaignService`), `POST /campaigns/{id}/rollouts` push
// Config/Firmware เข้ากลุ่มเป็นรอบๆ (`CampaignRolloutService` — แก้ไข
// 2026-09-24 ดู comment เหนือ `model CampaignRollout` ใน schema.prisma)
//
// export `CampaignRolloutService` ให้ `DeviceModule` import เข้าไปเรียก
// `recordTargetResult()` จาก `applyConfig`/`confirmFirmwareInstall` (Campaign
// Monitor #22 hook) — ทิศทางเดียว ไม่วนกลับ เพราะ service นี้ใช้แค่
// `PrismaService` ไม่ได้พึ่ง `DeviceService`
//
// AuthModule: JwtAuthGuard/JwtModule ร่วม (PermissionGuard resolve เองผ่าน
// PrismaModule @Global + Reflector)
//
// แก้ไข 2026-09-14: เอา NotificationModule ออก — Campaign ไม่สร้าง Task/
// มอบหมายงานให้ช่างหน้างานอีกต่อไป (ดู comment เหนือ CampaignService.create)
// จึงไม่มี notification ต้องส่งจากโมดูลนี้แล้ว
@Module({
  imports: [AuthModule],
  controllers: [CampaignController, CampaignRolloutController],
  providers: [CampaignService, CampaignRolloutService],
  exports: [CampaignService, CampaignRolloutService],
})
export class CampaignModule {}
