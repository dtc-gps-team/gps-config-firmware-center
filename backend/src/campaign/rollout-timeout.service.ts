import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import {
  APPLY_TIMEOUT_DETAIL_PREFIX,
  DEFAULT_APPLY_TIMEOUT_MINUTES,
  DEFAULT_PULL_TIMEOUT_HOURS,
  PULL_TIMEOUT_DETAIL_PREFIX,
} from './campaign-rollout-status';

export interface RolloutTimeoutSweepResult {
  /** เครื่องที่ไม่เคยมาดึงงานเกินเวลา -> `skipped_offline` */
  skippedOffline: number;
  /** เครื่องที่ดึงงานแล้วเงียบเกินเวลา -> `failed` */
  applyTimedOut: number;
}

/**
 * เวลารอเครื่องที่ไม่ตอบกลับของ Rollout โหมด real (docs/19 §16.3) — ตัดสินแทน
 * เครื่องที่ไม่ติดต่อกลับ เพื่อไม่ให้ Rollout ค้างรอตลอดไป (Auto Pause ไม่ทำงาน
 * และเปิดรอบใหม่ให้กลุ่มเดียวกันไม่ได้) แยกจาก `RolloutTimeoutJob` เพื่อให้
 * business logic เทสได้ตรงๆ โดยไม่ต้องยุ่งกับตัวตั้งเวลา
 *
 * | กรณี | เริ่มนับ | ผล | Auto Pause |
 * |---|---|---|---|
 * | ไม่เคยมาดึงงาน | `activeWindowStartedAt` (ปล่อย / Resume ล่าสุด) | `skipped_offline` | ไม่นับ |
 * | ดึงแล้วเงียบ | `pulledAt` | `failed` | นับ |
 *
 * - เวลารอแบบ "ไม่เคยมาดึง" ตรวจเฉพาะ Rollout ที่ `active` ระหว่าง `paused`
 *   เครื่องไม่ได้งานอยู่แล้ว จึงหยุดนับและนับใหม่จาก Resume (§16.3) ส่วนแบบ
 *   "ดึงแล้วเงียบ" ตรวจทั้ง `active` และ `paused` เพราะเครื่องได้ Config ไปแล้วจริง
 * - ผล "ดึงแล้วเงียบ" ผ่าน `recordTargetResult()` ตัวเดิม จึงได้ Auto Pause และ
 *   Incident ตามหัวข้อ 15 โดยไม่เขียนซ้ำ
 * - ทั้งสองทาง claim แบบ atomic (ระบุสถานะเดิม) ชนกับเครื่องที่รายงานเข้ามา
 *   พร้อมกันแล้วฝั่งที่แพ้ไม่นับซ้ำ
 */
@Injectable()
export class RolloutTimeoutService {
  private readonly logger = new Logger(RolloutTimeoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rolloutService: CampaignRolloutService,
  ) {}

  async sweep(now: Date = new Date()): Promise<RolloutTimeoutSweepResult> {
    const rollouts = await this.prisma.campaignRollout.findMany({
      where: {
        applyMode: 'real',
        payloadType: 'Config',
        status: { in: ['active', 'paused'] },
      },
    });

    const result: RolloutTimeoutSweepResult = {
      skippedOffline: 0,
      applyTimedOut: 0,
    };

    for (const rollout of rollouts) {
      // 1) ไม่เคยมาดึงงานเลยเกินเวลา (เฉพาะตอน active)
      if (rollout.status === 'active' && rollout.activeWindowStartedAt) {
        const hours = rollout.pullTimeoutHours ?? DEFAULT_PULL_TIMEOUT_HOURS;
        const deadline =
          rollout.activeWindowStartedAt.getTime() + hours * 3_600_000;
        if (now.getTime() >= deadline) {
          const waiting = await this.prisma.campaignRolloutTarget.findMany({
            where: { rolloutId: rollout.id, status: 'pending', pulledAt: null },
            select: { id: true },
          });
          for (const target of waiting) {
            const skipped = await this.rolloutService.markTargetSkippedOffline(
              target.id,
              `${PULL_TIMEOUT_DETAIL_PREFIX} ${hours} ชั่วโมง`,
            );
            if (skipped) result.skippedOffline += 1;
          }
        }
      }

      // 2) ดึงงานแล้วไม่รายงานผลเกินเวลา (active และ paused)
      const minutes =
        rollout.applyTimeoutMinutes ?? DEFAULT_APPLY_TIMEOUT_MINUTES;
      const cutoff = new Date(now.getTime() - minutes * 60_000);
      const silent = await this.prisma.campaignRolloutTarget.findMany({
        where: {
          rolloutId: rollout.id,
          status: 'pending',
          pulledAt: { lt: cutoff },
        },
        select: { deviceId: true },
      });
      for (const target of silent) {
        const claimed = await this.rolloutService.recordTargetResult(
          target.deviceId,
          { configId: rollout.configId as string },
          false,
          `${APPLY_TIMEOUT_DETAIL_PREFIX} ${minutes} นาที`,
          rollout.id,
        );
        if (claimed) result.applyTimedOut += 1;
      }
    }

    return result;
  }
}
