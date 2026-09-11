import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

// Campaign module (ฝั่ง A, Sprint 3 #21) — `POST /campaigns` สร้าง
// Campaign+CampaignTarget[]+Task[] ใน transaction เดียว (ดู campaign.service.ts)
//
// NotificationModule: แจ้งเตือน `task_assigned` ให้ผู้รับผิดชอบทุกเป้าหมาย
// ตอนสร้างแคมเปญ (mirror TaskModule) — AuthModule: JwtAuthGuard/JwtModule
// ร่วม (PermissionGuard resolve เองผ่าน PrismaModule @Global + Reflector)
@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
