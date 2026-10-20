import { Module } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { CentralDeviceModule } from '../central-device/central-device.module';
import { ConfigDefinitionModule } from '../config-definition/config-definition.module';
import {
  CONFIG_APPLIER,
  CONFIG_APPLY_MODE,
  type ConfigApplier,
  type ConfigApplyMode,
  MockConfigApplier,
  resolveConfigApplyMode,
} from '../device/config-applier';
import { CampaignController } from './campaign.controller';
import { CampaignRolloutController } from './campaign-rollout.controller';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CampaignService } from './campaign.service';
import { CentralRolloutPollJob } from './central-rollout-poll.job';
import { CentralRolloutPollService } from './central-rollout-poll.service';
import { RolloutEvents } from './rollout-events';
import { RolloutTimeoutJob } from './rollout-timeout.job';
import { RolloutTimeoutService } from './rollout-timeout.service';
import {
  FIRMWARE_ROLLBACK_EXECUTOR,
  type FirmwareRollbackExecutor,
  MockFirmwareRollbackExecutor,
} from './firmware-rollback-executor';

// Campaign module (ฝั่ง A, Sprint 3 #21/#22/#28) — `POST /campaigns` สร้างกลุ่ม
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
  // ConfigDefinitionModule: ตรวจค่าเฉพาะเครื่องของ Rollout เทียบคลัง Parameter
  // (`validateOperationOverridableFields`) ทิศทางเดียว ไม่วนกลับ
  // CentralDeviceModule: ส่ง Config ไป Server กลางในโหมด `central` (ทิศทางเดียว ไม่วนกลับ)
  imports: [AuthModule, ConfigDefinitionModule, CentralDeviceModule],
  controllers: [CampaignController, CampaignRolloutController],
  providers: [
    CampaignService,
    CampaignRolloutService,
    // event `rollout-failed` / `rollout-status-changed` (docs/19 §15.5) —
    // incident (A) และ notification (B) ฟังคนละโมดูล
    RolloutEvents,
    // เวลารอเครื่องที่ไม่ตอบกลับ (docs/19 §16) — งานตามเวลาทุก 5 นาที
    RolloutTimeoutService,
    RolloutTimeoutJob,
    // ถามผลคำสั่งของ Rollout โหมด central ทุก 4 วินาที
    CentralRolloutPollService,
    CentralRolloutPollJob,
    // FIRMWARE_ROLLBACK_EXECUTOR: env `FIRMWARE_ROLLBACK_MODE` (`mock`
    // default | `real`) ตาม Mock Mode Pattern เดียวกับ `CONFIG_APPLIER` ใน
    // `device.module.ts` — อยู่ที่นี่ไม่ใช่ device.module.ts เพราะใช้แค่ใน
    // `CampaignRolloutService` เท่านั้น (ดู comment เหนือ
    // `firmware-rollback-executor.ts` เรื่อง circular dependency)
    {
      provide: FIRMWARE_ROLLBACK_EXECUTOR,
      useFactory: (nestConfig: NestConfigService): FirmwareRollbackExecutor => {
        const mode = nestConfig.get<string>('FIRMWARE_ROLLBACK_MODE', 'mock');
        if (mode === 'real') {
          throw new Error(
            'FIRMWARE_ROLLBACK_MODE=real ยังไม่รองรับ (ยังไม่มีช่องทางสั่งกล่องสลับพาร์ทิชันจริง)',
          );
        }
        return new MockFirmwareRollbackExecutor();
      },
      inject: [NestConfigService],
    },
    // CONFIG_APPLIER: มติ 2026-09-29 — ระบบเป็น PULL model จริง (กล่องดึง
    // Config เองอัตโนมัติ) `CampaignRolloutService.approve()` จึง auto-apply
    // ให้ทุกเครื่องทันทีแทนที่จะรอช่างกดผ่าน Mobile เหมือนเดิม — provider
    // เดียวกับใน `device.module.ts` ทุกประการ (env `DEVICE_CONFIG_APPLY_MODE`
    // เดียวกัน) ประกาศซ้ำที่นี่แทนการ import `DeviceModule` เพราะ
    // `DeviceModule` import `CampaignModule` อยู่แล้ว (กัน circular
    // dependency เหตุผลเดียวกับ `FIRMWARE_ROLLBACK_EXECUTOR` ด้านบน) —
    // `MockConfigApplier` ไม่มี state จึงมี 2 instance คนละโมดูลได้โดยไม่มีผล
    {
      provide: CONFIG_APPLIER,
      useFactory: (nestConfig: NestConfigService): ConfigApplier => {
        // ตรวจค่า env ตอน startup (ค่าที่ไม่รู้จัก throw) — `real` ไม่ throw อีก
        // ต่อไป: หมายถึง "รอให้อุปกรณ์ดึงงานเอง" ไม่ได้เปลี่ยน applier ดู
        // comment เหนือ `ConfigApplyMode` ใน device/config-applier.ts
        resolveConfigApplyMode(
          nestConfig.get<string>('DEVICE_CONFIG_APPLY_MODE'),
        );
        return new MockConfigApplier();
      },
      inject: [NestConfigService],
    },
    // CONFIG_APPLY_MODE: โหมดของ Rollout ที่กำลังจะถูกปล่อย (docs/19 §3)
    // `release()` บันทึกค่านี้ลง `CampaignRollout.applyMode` ไม่อ่าน env ซ้ำ
    {
      provide: CONFIG_APPLY_MODE,
      useFactory: (nestConfig: NestConfigService): ConfigApplyMode =>
        resolveConfigApplyMode(
          nestConfig.get<string>('DEVICE_CONFIG_APPLY_MODE'),
        ),
      inject: [NestConfigService],
    },
  ],
  exports: [CampaignService, CampaignRolloutService, RolloutEvents],
})
export class CampaignModule {}
