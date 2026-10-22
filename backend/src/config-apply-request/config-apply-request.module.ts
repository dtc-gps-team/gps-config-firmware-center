import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
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
  PendingFieldApplyRolloutStarter,
} from './field-apply-rollout';

// docs/25 — คำขอส่ง Config เข้าเครื่องจริงจากหน้างาน (โมดูลของ B ตาม §6)
//
// imports:
//   - AuthModule — JwtAuthGuard/JwtModule ร่วม (PermissionGuard resolve เองผ่าน
//     PrismaModule @Global + Reflector)
//   - CampaignModule — `RolloutEvents` สำหรับฟังผลของ Rollout เครื่องเดียว
//     (ทิศทางเดียว: campaign ไม่ import โมดูลนี้)
//   - NotificationModule — config_apply_*
//   - TaskModule — `TaskService.findOne()` ใช้กฎเห็นงานชุดเดียวกับ GET /tasks/{id}
@Module({
  imports: [AuthModule, CampaignModule, NotificationModule, TaskModule],
  controllers: [TaskConfigApplyRequestController, ConfigApplyRequestController],
  providers: [
    ConfigApplyRequestService,
    ConfigApplyRequestExpiryJob,
    // TODO(A, docs/25 §3.5): เปลี่ยนเป็น implementation ใน CampaignRolloutService
    // (เช่น `{ provide: FIELD_APPLY_ROLLOUT_STARTER, useExisting:
    // CampaignRolloutService }`) เมื่อ A เพิ่มเมธอดแล้ว — ระหว่างนี้อนุมัติได้ 503
    // และคำขอยัง pending
    {
      provide: FIELD_APPLY_ROLLOUT_STARTER,
      useClass: PendingFieldApplyRolloutStarter,
    },
  ],
  exports: [ConfigApplyRequestService],
})
export class ConfigApplyRequestModule {}
