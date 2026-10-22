import { Injectable, Logger, Optional } from '@nestjs/common';
import { CentralDeviceService } from '../central-device/central-device.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignRolloutService } from './campaign-rollout.service';

export interface CentralPollResult {
  success: number;
  failed: number;
  skipped: number;
  /** ถามไม่ได้ตอนนี้ (Server กลางติดต่อไม่ได้) จะถามใหม่รอบหน้า */
  unavailable: number;
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
 */
@Injectable()
export class CentralRolloutPollService {
  private readonly logger = new Logger(CentralRolloutPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rolloutService: CampaignRolloutService,
    @Optional() private readonly central?: CentralDeviceService,
  ) {}

  async poll(): Promise<CentralPollResult> {
    const result: CentralPollResult = {
      success: 0,
      failed: 0,
      skipped: 0,
      unavailable: 0,
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

      const outcome = await this.central.getCommandOutcome(commandId);
      switch (outcome.kind) {
        case 'pending':
          break;
        case 'unavailable':
          result.unavailable += 1;
          break;
        case 'success': {
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
        case 'failed': {
          const claimed = await this.rolloutService.recordTargetResult(
            target.deviceId,
            payload as { configId: string } | { firmwareId: string },
            false,
            outcome.detail,
            target.rolloutId,
          );
          if (claimed) result.failed += 1;
          break;
        }
        case 'skipped': {
          const skipped = await this.rolloutService.markTargetSkippedOffline(
            target.id,
            outcome.detail,
          );
          if (skipped) result.skipped += 1;
          break;
        }
      }
    }
    return result;
  }
}
