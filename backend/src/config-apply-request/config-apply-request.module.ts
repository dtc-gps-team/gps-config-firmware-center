import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignRolloutService } from '../campaign/campaign-rollout.service';
import { CampaignModule } from '../campaign/campaign.module';
import { NotificationModule } from '../notification/notification.module';
import { TaskModule } from '../task/task.module';
import {
  ConfigApplyRequestController,
  TaskConfigApplyRequestController,
} from './config-apply-request.controller';
import { ConfigApplyRequestExpiryJob } from './config-apply-request.job';
import { ConfigApplyRequestService } from './config-apply-request.service';
import {
  FIELD_APPLY_ROLLOUT_STARTER,
  type FieldApplyRolloutStarter,
} from './field-apply-rollout';

// docs/25 — คำขอส่ง Config เข้าเครื่องจริงจากหน้างาน (โมดูลของ B ตาม §6)
//
// imports:
//   - AuthModule — JwtAuthGuard/JwtModule ร่วม (PermissionGuard resolve เองผ่าน
//     PrismaModule @Global + Reflector)
//   - CampaignModule — `CampaignRolloutService` (สร้าง/เริ่มส่ง Rollout เครื่องเดียว)
//     และ `RolloutEvents` สำหรับฟังผล (ทิศทางเดียว: campaign ไม่ import โมดูลนี้)
//   - NotificationModule — config_apply_*
//   - TaskModule — `TaskService.findOne()` ใช้กฎเห็นงานชุดเดียวกับ GET /tasks/{id}
@Module({
  imports: [AuthModule, CampaignModule, NotificationModule, TaskModule],
  controllers: [TaskConfigApplyRequestController, ConfigApplyRequestController],
  providers: [
    ConfigApplyRequestService,
    ConfigApplyRequestExpiryJob,
    // docs/25 §3.5 ข้อ 2-3 — เมธอดของ A ใน CampaignRolloutService (#362) ·
    // useFactory แทน useExisting เพื่อให้ TypeScript ตรวจตอน compile ว่า
    // CampaignRolloutService ยังตรงกับ `FieldApplyRolloutStarter` (useExisting
    // ไม่ตรวจชนิด) — คืน instance เดียวกับที่ CampaignModule export
    {
      provide: FIELD_APPLY_ROLLOUT_STARTER,
      useFactory: (
        rollouts: CampaignRolloutService,
      ): FieldApplyRolloutStarter => rollouts,
      inject: [CampaignRolloutService],
    },
  ],
  exports: [ConfigApplyRequestService],
})
export class ConfigApplyRequestModule {}
