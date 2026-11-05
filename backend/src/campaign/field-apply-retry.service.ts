import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CampaignRolloutStatus } from '@prisma/client';
import {
  isRetryableCentralOutcome,
  type CentralCommandOutcome,
} from '../central-device/central-config';
import { PrismaService } from '../prisma/prisma.service';
import { FIELD_APPLY_SYSTEM_CAMPAIGN_NAME } from './field-apply-system-campaign';
import { FIELD_APPLY_RETRY_EVENT, RolloutEvents } from './rollout-events';

/** ค่าตั้งของการลองส่งใหม่ (docs/31 §3.2, §3.4) — env ใน `campaign.module.ts` */
export interface FieldApplyRetrySettings {
  /** รวมทุกครั้ง (ครั้งแรก + ลองซ้ำ) — `FIELD_APPLY_MAX_ATTEMPTS` */
  maxAttempts: number;
  /** รอก่อนรอบที่ 2 (รอบถัดไปคูณ 2) — `FIELD_APPLY_RETRY_DELAY_SEC` */
  retryDelaySec: number;
  /** อายุ lease ระหว่างกำลังส่ง ต้องมากกว่าเวลาส่งหนึ่งครั้ง — `FIELD_APPLY_CLAIM_LEASE_SEC` */
  claimLeaseSec: number;
}

export const FIELD_APPLY_RETRY_SETTINGS = Symbol('FIELD_APPLY_RETRY_SETTINGS');

export const DEFAULT_FIELD_APPLY_RETRY_SETTINGS: FieldApplyRetrySettings = {
  maxAttempts: 3,
  retryDelaySec: 30,
  claimLeaseSec: 60,
};

/** ผลที่ทำให้รอบหนึ่งไม่สำเร็จ — ผลจบจาก poll (`failed`/`skipped`) หรือส่งไม่ถึง Server กลาง */
export type FieldApplyFailure =
  | Extract<CentralCommandOutcome, { kind: 'failed' | 'skipped' }>
  /** ติดต่อ Server กลางไม่ได้ตอนส่ง / throw ระหว่างส่ง — ลองใหม่ได้ */
  | { kind: 'unavailable'; detail: string }
  /** Server กลางปฏิเสธคำสั่ง (ไม่รู้จักกล่อง, ไม่ผ่าน schema) — ส่งซ้ำก็ผิดซ้ำ */
  | { kind: 'rejected'; detail: string };

/** target ในมุมที่การตัดสินต้องรู้ */
export interface FieldApplyRetryTarget {
  id: string;
  rolloutId: string;
  attemptCount: number;
}

/** ผลการตัดสินหลังรอบหนึ่งไม่สำเร็จ */
export type FieldApplyRetryDecision =
  /** ตั้งรอบใหม่แล้ว — ผู้เรียกไม่ต้องทำอะไรต่อ */
  | { kind: 'scheduled'; nextRetryAt: Date }
  /** จบ — ผู้เรียกบันทึกผลด้วยเส้นทางเดิม: `skipped` → `markTargetSkippedOffline()`
   * นอกนั้น `recordTargetResult(false)` · `detail` สรุปทุกรอบเมื่อลองมากกว่า 1 ครั้ง */
  | { kind: 'finish'; outcome: 'failed' | 'skipped'; detail: string };

/** งานที่ poll ต้องทำต่อกับ target ที่ถึงเวลา (`claimDueRetries()`) */
export type FieldApplyDueAction =
  /** claim รอบใหม่แล้ว (lease) — เรียก `startFieldApplyRollout()` ส่งของเดิมอีกครั้ง */
  | { kind: 'push'; rolloutId: string; targetId: string; actorId: string }
  /** จบเลย (Rollout ไม่ active แล้ว หรือ lease ของรอบสุดท้ายหมด) */
  | {
      kind: 'finish';
      targetId: string;
      rolloutId: string;
      deviceId: string;
      payload: { configId: string } | { firmwareId: string };
      outcome: 'failed' | 'skipped';
      detail: string;
    };

const STUCK_DETAIL =
  'ส่งไม่ถึง Server กลาง (ระบบหยุดกลางทางหลังเริ่มส่ง ไม่ได้รับรหัสคำสั่ง)';
const NOT_ACTIVE_DETAIL = 'Rollout ไม่ได้ทำงานต่อแล้ว ไม่ลองส่งรอบใหม่';

/**
 * ลองส่งเข้ากล่องใหม่อัตโนมัติ (docs/31) — เฉพาะ Rollout เครื่องเดียวของคำขอส่งจากหน้างาน
 * (Campaign ระบบ `FIELD_APPLY_SYSTEM_CAMPAIGN_NAME`) โหมด `central`
 *
 * - เก็บประวัติทุกรอบใน `CampaignRolloutTargetAttempt`
 * - ตัดสินหลังรอบที่ไม่สำเร็จ (`decideAfterFailure()`) — จุดดัก 2 ทาง (§3.1): ผลจบจาก poll และส่งไม่ถึง
 *   Server กลาง (`pushToCentral()` / `pushFirmwareToCentral()`) · **ไม่บันทึกผลจบเอง** คืน
 *   `finish` ให้ผู้เรียกใช้ `recordTargetResult()` / `markTargetSkippedOffline()` เดิม
 *   (ไม่เปลี่ยนความหมายของสองเมธอดนั้น — Campaign ปกติเรียกแบบเดิมทุกกรณี)
 * - หยิบรอบที่ถึงเวลาแบบ lease (`claimDueRetries()`) กันค้างหลัง claim (รีวิว A #436 รอบ 2)
 *
 * ไม่ inject `CampaignRolloutService` (กัน circular) — ผู้เรียกทำการส่ง/บันทึกผลเอง
 */
@Injectable()
export class FieldApplyRetryService {
  private readonly logger = new Logger(FieldApplyRetryService.name);
  readonly settings: FieldApplyRetrySettings;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rolloutEvents: RolloutEvents,
    @Optional()
    @Inject(FIELD_APPLY_RETRY_SETTINGS)
    settings?: FieldApplyRetrySettings,
  ) {
    this.settings = settings ?? DEFAULT_FIELD_APPLY_RETRY_SETTINGS;
  }

  /** เวลารอก่อนรอบถัดไปหลังรอบที่ `attemptNo` ไม่สำเร็จ: 30 → 60 วินาที (§3.2) */
  retryDelayMs(attemptNo: number): number {
    return this.settings.retryDelaySec * 1000 * 2 ** Math.max(0, attemptNo - 1);
  }

  /** Rollout ของคำขอส่งจากหน้างานไหม (เช็คชื่อ Campaign ระบบแบบเดียวกับ `recordTargetResult()`) */
  async isFieldApplyRollout(rolloutId: string): Promise<boolean> {
    const rollout = await this.prisma.campaignRollout.findUnique({
      where: { id: rolloutId },
      select: { campaign: { select: { name: true } } },
    });
    return rollout?.campaign?.name === FIELD_APPLY_SYSTEM_CAMPAIGN_NAME;
  }

  /** เริ่มรอบ `attemptNo` (idempotent — รอบลองใหม่ถูกสร้างไว้แล้วตอน claim) */
  async beginAttempt(targetId: string, attemptNo: number): Promise<void> {
    await this.prisma.campaignRolloutTargetAttempt.upsert({
      where: { targetId_attemptNo: { targetId, attemptNo } },
      create: { targetId, attemptNo, status: 'sending' },
      update: {},
    });
  }

  /** Server กลางรับคำสั่งของรอบนี้แล้ว */
  async markAttemptSent(
    targetId: string,
    attemptNo: number,
    centralCommandId: string,
  ): Promise<void> {
    await this.prisma.campaignRolloutTargetAttempt.updateMany({
      where: { targetId, attemptNo },
      data: { status: 'sent', centralCommandId },
    });
  }

  /** รอบล่าสุดสำเร็จ — best effort (ไม่ทำให้การบันทึกผลสำเร็จล้ม) */
  async markLatestAttemptSucceeded(targetId: string): Promise<void> {
    try {
      const latest = await this.latestAttempt(targetId);
      if (!latest || latest.finishedAt) return;
      await this.prisma.campaignRolloutTargetAttempt.update({
        where: { id: latest.id },
        data: { status: 'succeeded', finishedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `บันทึกรอบที่สำเร็จไม่ได้ (target ${targetId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * หลังรอบหนึ่งไม่สำเร็จ: ปิดรอบนั้น แล้วตั้งรอบใหม่ถ้าลองได้ (Rollout ยัง `active` + ผลลองใหม่ได้ +
   * ยังไม่ครบ) ไม่งั้นคืน `finish` พร้อมสรุปทุกรอบ
   */
  async decideAfterFailure(
    target: FieldApplyRetryTarget,
    failure: FieldApplyFailure,
  ): Promise<FieldApplyRetryDecision> {
    const errorCode =
      'errorCode' in failure ? (failure.errorCode ?? null) : null;
    await this.closeAttempt(target.id, target.attemptCount, {
      status: failure.kind === 'skipped' ? 'skipped' : 'failed',
      errorCode,
      detail: failure.detail,
    });

    const outcome = failure.kind === 'skipped' ? 'skipped' : 'failed';
    const retryable =
      failure.kind === 'unavailable' ||
      (failure.kind !== 'rejected' && isRetryableCentralOutcome(failure));
    const rollout = await this.prisma.campaignRollout.findUnique({
      where: { id: target.rolloutId },
      select: { status: true },
    });
    if (
      retryable &&
      rollout?.status === 'active' &&
      target.attemptCount < this.settings.maxAttempts
    ) {
      const nextRetryAt = new Date(
        Date.now() + this.retryDelayMs(target.attemptCount),
      );
      const scheduled = await this.prisma.campaignRolloutTarget.updateMany({
        where: {
          id: target.id,
          status: 'pending',
          attemptCount: target.attemptCount,
        },
        data: { centralCommandId: null, nextRetryAt },
      });
      if (scheduled.count > 0) {
        this.rolloutEvents.safeEmit(FIELD_APPLY_RETRY_EVENT, {
          rolloutId: target.rolloutId,
          attemptNo: target.attemptCount,
          maxAttempts: this.settings.maxAttempts,
          errorCode,
          detail: failure.detail,
          nextRetryAt: nextRetryAt.toISOString(),
        });
        return { kind: 'scheduled', nextRetryAt };
      }
    }
    return {
      kind: 'finish',
      outcome,
      detail: await this.summarize(target.id, failure.detail),
    };
  }

  /**
   * หา target ที่ถึงเวลาลองใหม่ (หรือ lease หมด) แล้ว claim ทีละตัวแบบ atomic (§3.4):
   * `where` มี `attemptCount` + `nextRetryAt` เดิม สอง poll จึงหยิบตัวเดียวกันไม่ได้ · claim ตั้ง
   * `nextRetryAt = now + lease` (ไม่ใช่ null) ถ้า process ตายหลัง claim พอ lease หมดก็ถูกหยิบใหม่
   */
  async claimDueRetries(
    now: Date = new Date(),
  ): Promise<FieldApplyDueAction[]> {
    const due = await this.prisma.campaignRolloutTarget.findMany({
      where: {
        status: 'pending',
        centralCommandId: null,
        nextRetryAt: { not: null, lte: now },
        rollout: {
          applyMode: 'central',
          status: { in: ['active', 'paused'] },
          campaign: { name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME },
        },
      },
      include: {
        rollout: {
          select: {
            status: true,
            payloadType: true,
            configId: true,
            firmwareId: true,
            approvedBy: true,
            createdBy: true,
          },
        },
      },
      orderBy: { nextRetryAt: 'asc' },
    });

    const actions: FieldApplyDueAction[] = [];
    for (const target of due) {
      const action = await this.claimOne(target, now);
      if (action) actions.push(action);
    }
    return actions;
  }

  private async claimOne(
    target: {
      id: string;
      rolloutId: string;
      deviceId: string;
      attemptCount: number;
      nextRetryAt: Date | null;
      rollout: {
        status: CampaignRolloutStatus;
        payloadType: string;
        configId: string | null;
        firmwareId: string | null;
        approvedBy: string | null;
        createdBy: string;
      };
    },
    now: Date,
  ): Promise<FieldApplyDueAction | null> {
    const payload =
      target.rollout.payloadType === 'Firmware'
        ? target.rollout.firmwareId
          ? { firmwareId: target.rollout.firmwareId }
          : null
        : target.rollout.configId
          ? { configId: target.rollout.configId }
          : null;
    if (!payload) return null; // defensive — Rollout ต้องมี payload เสมอ

    const latest = await this.latestAttempt(target.id);
    const stuck = !!latest && !latest.finishedAt;
    const notActive = target.rollout.status !== 'active';
    const exhausted = target.attemptCount >= this.settings.maxAttempts;
    const finishNow = notActive || exhausted;

    const claim = await this.prisma.campaignRolloutTarget.updateMany({
      where: {
        id: target.id,
        status: 'pending',
        centralCommandId: null,
        attemptCount: target.attemptCount,
        nextRetryAt: target.nextRetryAt,
      },
      // lease ทั้งสองทาง (รีวิว A #440): ทางจบก็ตั้ง lease ไม่ใช่ null — ถ้า process ตายก่อน
      // ผู้เรียกบันทึกผลจบ lease หมดแล้วรอบ poll ถัดไปหยิบมาจบใหม่ ไม่ค้าง pending ถาวร ·
      // บันทึกผลสำเร็จ status เปลี่ยนจาก pending ก็ไม่ถูกหยิบอีก · ทางจบไม่แตะ attemptCount
      data: {
        ...(finishNow ? {} : { attemptCount: target.attemptCount + 1 }),
        nextRetryAt: new Date(
          now.getTime() + this.settings.claimLeaseSec * 1000,
        ),
      },
    });
    if (claim.count === 0) return null; // poll อื่นหยิบไปแล้ว

    if (stuck) {
      await this.closeAttempt(target.id, target.attemptCount, {
        status: 'failed',
        errorCode: null,
        detail: STUCK_DETAIL,
      });
    }

    if (finishNow) {
      // จบด้วยผลของรอบล่าสุด (รีวิว A #436: Rollout ไม่ active ตอนถึงเวลา → ไม่ค้าง pending)
      const last = stuck ? null : latest;
      const lastDetail = stuck
        ? STUCK_DETAIL
        : (last?.detail ?? NOT_ACTIVE_DETAIL);
      return {
        kind: 'finish',
        targetId: target.id,
        rolloutId: target.rolloutId,
        deviceId: target.deviceId,
        payload,
        outcome: last?.status === 'skipped' ? 'skipped' : 'failed',
        detail: await this.summarize(
          target.id,
          notActive ? `${lastDetail} (${NOT_ACTIVE_DETAIL})` : lastDetail,
        ),
      };
    }

    await this.beginAttempt(target.id, target.attemptCount + 1);
    return {
      kind: 'push',
      rolloutId: target.rolloutId,
      targetId: target.id,
      actorId: target.rollout.approvedBy ?? target.rollout.createdBy,
    };
  }

  private latestAttempt(targetId: string) {
    return this.prisma.campaignRolloutTargetAttempt.findFirst({
      where: { targetId },
      orderBy: { attemptNo: 'desc' },
    });
  }

  /** ปิดรอบ `attemptNo` ที่ยังไม่จบ (รอบที่ไม่มีแถว เช่น target ก่อน docs/31 สร้างให้เลย) */
  private async closeAttempt(
    targetId: string,
    attemptNo: number,
    result: { status: string; errorCode: string | null; detail: string },
  ): Promise<void> {
    await this.prisma.campaignRolloutTargetAttempt.upsert({
      where: { targetId_attemptNo: { targetId, attemptNo } },
      create: { targetId, attemptNo, ...result, finishedAt: new Date() },
      update: { ...result, finishedAt: new Date() },
    });
  }

  /** ลองครั้งเดียว = ข้อความเดิม · หลายครั้ง = สรุปทุกรอบ (§3.4 "สรุปทุกรอบ") */
  private async summarize(
    targetId: string,
    lastDetail: string,
  ): Promise<string> {
    const attempts = await this.prisma.campaignRolloutTargetAttempt.findMany({
      where: { targetId },
      orderBy: { attemptNo: 'asc' },
      select: { attemptNo: true, detail: true },
    });
    if (attempts.length <= 1) return lastDetail;
    const rounds = attempts
      .map((a) => `รอบ ${a.attemptNo}: ${a.detail ?? '-'}`)
      .join(' · ');
    return `ส่ง ${attempts.length} ครั้งไม่สำเร็จ — ${rounds}`;
  }
}
