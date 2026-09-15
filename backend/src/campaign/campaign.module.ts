import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

// Campaign module (ฝั่ง A, Sprint 3 #21) — `POST /campaigns` สร้าง
// Campaign+CampaignTarget[] ใน transaction เดียว (ดู campaign.service.ts)
//
// AuthModule: JwtAuthGuard/JwtModule ร่วม (PermissionGuard resolve เองผ่าน
// PrismaModule @Global + Reflector)
//
// แก้ไข 2026-09-14: เอา NotificationModule ออก — Campaign ไม่สร้าง Task/
// มอบหมายงานให้ช่างหน้างานอีกต่อไป (ดู comment เหนือ CampaignService.create)
// จึงไม่มี notification ต้องส่งจากโมดูลนี้แล้ว
@Module({
  imports: [AuthModule],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
