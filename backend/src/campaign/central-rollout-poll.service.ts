import { Injectable, Logger, Optional } from '@nestjs/common';
import { CentralDeviceService } from '../central-device/central-device.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import {
  FieldApplyRetryService,
  isAutoRetryCampaign,
  type FieldApplyDueAction,
} from './field-apply-retry.service';

export interface CentralPollResult {
  success: number;
  failed: number;
  skipped: number;
  /** ถามไม่ได้ตอนนี้ (Server กลางติดต่อไม่ได้) จะถามใหม่รอบหน้า */
  unavailable: number;
  /** รอบที่ไม่สำเร็จแล้วตั้งรอบใหม่ (docs/31) */
  retrying: number;
  /** ส่งรอบใหม่ที่ถึงเวลาแล้วในรอบ poll นี้ (docs/31) */
  retried: number;
}

/**
 * ถามผลคำสั่งที่ Rollout โหมด `central` สั่งไว้ที่ Server กลาง แล้วบันทึกผลรายเครื่อง
 * (ตัดสินแบบ poll ไม่รอ webhook เพราะเรียกออกไปหา Server กลางได้เสมอ ไม่พึ่งเครือข่ายขาเข้า)
 *
 * | ผลที่ Server กลางรายงาน | บันทึกเป็น | Auto Pause |
 * |---|---|---|
 * | SUCCESS | success | - |
 * | FAILED, ROLLED_BACK, DEVICE_NO_RESPONSE | failed | นับ |
 * | DEVICE_OFFLINE (gateway ตั้งเป็น FAILED), TTL_EXPIRED | skipped_offline | ไม่นับ |
 * | SUPERSEDED, CANCELLED (EXPIRED) | skipped_offline | ไม่นับ |
 * | สถานะระหว่างทาง | รอต่อ | - |
 *
 * ผลล้มเหลวผ่าน `recordTargetResult()` ตัวเดิมเสมอ ได้ Auto Pause และ Incident ตาม
 * docs/19 หัวข้อ 15 โดยไม่เขียนซ้ำ — **ผลสำเร็จแยกตาม payloadType**: Config ผ่าน
 * `recordTargetResult()` ตรงๆ (ไม่มี bookkeeping อะไรเพิ่ม) ส่วน Firmware ผ่าน
 * `confirmCentralFirmwareSuccess()` ก่อน (เขียน Dual Partition bookkeeping ให้
 * ตอนนี้ที่รู้ผลจริงแล้ว ไม่ใช่ตอนสั่ง) · เวลารอเครื่องออฟไลน์/ไม่ตอบ Server กลางกำหนดเอง
 * (delivery 600 วินาที, ตอบกลับตามชนิดคำสั่ง) ไม่ใช้ `RolloutTimeoutService` ของโหมด real
 *
 * **ลองส่งใหม่อัตโนมัติ (docs/31)** เฉพาะ Rollout ส่งจากหน้างาน: ผลล้มเหลว/ข้ามผ่าน
 * `FieldApplyRetryService.decideAfterFailure()` ก่อน (จุดดักทางที่ 1 — ทางที่ 2 อยู่ใน
 * `CampaignRolloutService.pushToCentral()`) ลองใหม่ได้ = ตั้งรอบใหม่ ไม่บันทึกผล · ไม่ได้ = บันทึก
 * ด้วย `recordTargetResult()` / `markTargetSkippedOffline()` เดิมพร้อมสรุปทุกรอบ · ท้ายทุกรอบ poll
 * หยิบรอบใหม่ที่ถึงเวลาแล้วส่งของเดิมอีกครั้ง · Campaign ปกติทำงานแบบเดิมทุกประการ
 */
@Injectable()
export class CentralRolloutPollService {
  private readonly logger = new Logger(CentralRolloutPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rolloutService: CampaignRolloutService,
    @Optional() private readonly central?: CentralDeviceService,
    @Optional() private readonly fieldApplyRetry?: FieldApplyRetryService,
  ) {}

  async poll(): Promise<CentralPollResult> {
    const result: CentralPollResult = {
      success: 0,
      failed: 0,
      skipped: 0,
      unavailable: 0,
      retrying: 0,
      retried: 0,
    };
    if (!this.central) return result;

    const targets = await this.prisma.campaignRolloutTarget.findMany({
      where: {
        status: 'pending',
        centralCommandId: { not: null },
        rollout: {
          applyMode: 'central',
          payloadType: { in: ['Config', 'Firmware'] },
          status: { in: ['active', 'paused'] },
        },
      },
      include: {
        rollout: {
          select: {
            id: true,
            payloadType: true,
            configId: true,
            firmwareId: true,
            // docs/31 — รู้ว่าเป็น Rollout ส่งจากหน้างานไหม (รีวิว A #436)
            campaign: { select: { name: true, autoRetry: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const target of targets) {
      const commandId = target.centralCommandId as string;
      const isFirmware = target.rollout.payloadType === 'Firmware';
      const payload = isFirmware
        ? { firmwareId: target.rollout.firmwareId }
        : { configId: target.rollout.configId };
      // defensive — Config rollout ต้องมี configId เสมอ, Firmware ต้องมี firmwareId เสมอ
      if (!payload.configId && !payload.firmwareId) continue;
      // เปิดลองใหม่: Campaign ระบบ (หน้างาน) เสมอ · Campaign ปกติตามสวิตช์ (อ่านสดทุกรอบ poll)
      const retry =
        this.fieldApplyRetry && isAutoRetryCampaign(target.rollout.campaign)
          ? this.fieldApplyRetry
          : null;

      const outcome = await this.central.getCommandOutcome(commandId);
      switch (outcome.kind) {
        case 'pending':
          break;
        case 'unavailable':
          result.unavailable += 1;
          break;
        case 'success': {
          if (retry) await retry.markLatestAttemptSucceeded(target.id);
          const detail = isFirmware
            ? `Server กลางยืนยันแล้ว คำสั่ง ${commandId}: กล่องติดตั้ง Firmware สำเร็จ`
            : `Server กลางยืนยันแล้ว คำสั่ง ${commandId}: กล่องรับ Config ใหม่สำเร็จ`;
          const claimed =
            isFirmware && payload.firmwareId
              ? await this.rolloutService.confirmCentralFirmwareSuccess(
                  target.deviceId,
                  payload.firmwareId,
                  target.rolloutId,
                  detail,
                )
              : await this.rolloutService.recordTargetResult(
                  target.deviceId,
                  payload as { configId: string },
                  true,
                  detail,
                  target.rolloutId,
                );
          if (claimed) result.success += 1;
          break;
        }
        case 'failed':
        case 'skipped': {
          let detail = outcome.detail;
          let finishAs: 'failed' | 'skipped' = outcome.kind;
          if (retry) {
            const decision = await retry.decideAfterFailure(target, outcome);
            if (decision.kind === 'scheduled') {
              result.retrying += 1;
              break;
            }
            detail = decision.detail;
            finishAs = decision.outcome;
          }
          if (finishAs === 'skipped') {
            const skipped = await this.rolloutService.markTargetSkippedOffline(
              target.id,
              detail,
            );
            if (skipped) result.skipped += 1;
          } else {
            const claimed = await this.rolloutService.recordTargetResult(
              target.deviceId,
              payload as { configId: string } | { firmwareId: string },
              false,
              detail,
              target.rolloutId,
            );
            if (claimed) result.failed += 1;
          }
          break;
        }
      }
    }

    if (this.fieldApplyRetry) {
      // claim ทีละตัวตอนจะส่ง ไม่เกิน `maxDuePerPoll` ตัวต่อรอบ (docs/31 §6.3 ข้อ 1)
      await this.fieldApplyRetry.processDueRetries((action) =>
        this.runDueAction(action, result),
      );
    }
    return result;
  }

  /** รอบใหม่ที่ถึงเวลา (docs/31 §3.4): ส่งของเดิมอีกครั้ง หรือจบด้วยผลของรอบล่าสุด */
  private async runDueAction(
    action: FieldApplyDueAction,
    result: CentralPollResult,
  ): Promise<void> {
    if (action.kind === 'push') {
      try {
        await this.rolloutService.startFieldApplyRollout(
          action.rolloutId,
          action.actorId,
          { retryTargetId: action.targetId },
        );
        result.retried += 1;
      } catch (err) {
        // lease ยังอยู่ — หมดแล้วรอบ poll ถัดไปหยิบใหม่เอง ไม่ค้าง
        this.logger.warn(
          `ส่งรอบใหม่ของ Rollout ${action.rolloutId} ไม่สำเร็จ: ${(err as Error).message}`,
        );
      }
      return;
    }
    if (action.outcome === 'skipped') {
      const skipped = await this.rolloutService.markTargetSkippedOffline(
        action.targetId,
        action.detail,
      );
      if (skipped) result.skipped += 1;
      return;
    }
    const claimed = await this.rolloutService.recordTargetResult(
      action.deviceId,
      action.payload,
      false,
      action.detail,
      action.rolloutId,
    );
    if (claimed) result.failed += 1;
  }
}
