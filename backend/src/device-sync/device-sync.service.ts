import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from '@prisma/client';
import { CampaignRolloutService } from '../campaign/campaign-rollout.service';
import { TARGETABLE_DEVICE_STATUS } from '../campaign/campaign-rollout.service';
import { APPLICABLE_CONFIG_STATUSES } from '../device/config-applier';
import { mergeApprovedOverride } from '../device/config-override-merge';
import { PrismaService } from '../prisma/prisma.service';
import { JobResult } from './dto/report-job-result.dto';

/** ให้อุปกรณ์รอกี่วินาทีก่อนดึงงานครั้งถัดไป (docs/19 §4.1) */
export const DEVICE_SYNC_POLL_AFTER_SECONDS = 30;

export interface DeviceConfigJob {
  /** `CampaignRolloutTarget.id` — ใช้เป็น path ตอนรายงานผล */
  jobId: string;
  rolloutId: string;
  /** เวลาที่งานถูกสร้าง (ISO 8601) เครื่องต้องทำเรียงจากเก่าไปใหม่ */
  createdAt: string;
  payloadType: 'Config';
  config: {
    configId: string;
    name: string;
    deviceModel: string;
    protocol: string;
    /** ค่าหลังรวมค่าเฉพาะเครื่องที่อนุมัติแล้ว ค่า sensitive เป็นค่าจริง
     * เพราะอุปกรณ์ต้องใช้งาน */
    fields: Record<string, unknown>;
  };
}

export interface DeviceJobsResponse {
  serverTime: string;
  pollAfterSeconds: number;
  jobs: DeviceConfigJob[];
}

export type JobReportRejection = 'already-reported' | 'rollout-closed';

export type JobReportResponse =
  { accepted: true } | { accepted: false; reason: JobReportRejection };

const ROLLOUT_OPEN_FOR_RESULT = ['active', 'paused'] as const;

/**
 * ฝั่ง "อุปกรณ์ดึงงานเอง" ของ Campaign Rollout (docs/19 §4) — Rollout ที่ปล่อย
 * ในโหมด `real` (`CampaignRollout.applyMode = 'real'`) จะไม่ถูก backend apply
 * ให้ เครื่องเป้าหมายค้าง `pending` จนกว่าเครื่องนั้นจะมาดึงงานและรายงานผล
 *
 * - **การนับผล / Auto Pause / ปิด Rollout ใช้ `recordTargetResult()` ตัวเดิม**
 *   ทั้งหมด ไม่เขียนซ้ำ
 * - **ไม่ลง AuditLog** (ตกลงกับ B 15 ต.ค. 2569, docs/19 §14 ข้อ 1) Audit Log
 *   เป็นของการกระทำของคน ผลของเครื่องเก็บที่ target พร้อมเวลาอยู่แล้ว
 * - ทุก method รับ `deviceId` ที่ผ่าน `DeviceApiKeyGuard` แล้วเท่านั้น และ
 *   scope ทุก query ด้วย deviceId นั้น (IDOR Prevention ใน CLAUDE.md) เครื่อง
 *   หนึ่งดึงหรือรายงานงานของอีกเครื่องไม่ได้
 */
@Injectable()
export class DeviceSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignRolloutService: CampaignRolloutService,
  ) {}

  /**
   * `GET /device-sync/{deviceId}/jobs` — งาน Config ที่รอเครื่องนี้ทำ
   *
   * คืนเฉพาะ target `pending` ของ Rollout ที่ `active` และ `applyMode = real`
   * Rollout ที่ `paused` (Auto Pause) จึงไม่แจกงานใหม่ ซึ่งเป็นสิ่งที่ทำให้
   * Auto Pause หยุดเครื่องที่ยังไม่ดึงได้จริง
   *
   * เช็คความถูกต้องของ Config และอุปกรณ์ซ้ำทุกครั้งก่อนส่ง (เวลาผ่านไปได้
   * ระหว่างรอ — Config อาจถูกลบหรือถอนอนุมัติ เครื่องอาจถูก decommission)
   * ไม่ผ่านจะบันทึกเป็น `failed` พร้อมเหตุผลผ่าน `recordTargetResult()` เหมือน
   * `autoApplyConfig()` ในโหมด `mock` ทุกประการ แทนการส่งค่าที่ไม่ควรส่ง
   */
  async listJobs(deviceId: string): Promise<DeviceJobsResponse> {
    const targets = await this.prisma.campaignRolloutTarget.findMany({
      where: {
        deviceId,
        status: 'pending',
        rollout: {
          status: 'active',
          applyMode: 'real',
          payloadType: 'Config',
          configId: { not: null },
        },
      },
      include: { rollout: true },
      orderBy: { createdAt: 'asc' },
    });

    const response: DeviceJobsResponse = {
      serverTime: new Date().toISOString(),
      pollAfterSeconds: DEVICE_SYNC_POLL_AFTER_SECONDS,
      jobs: [],
    };
    if (targets.length === 0) return response;

    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    const configCache = new Map<string, Config | null>();

    for (const target of targets) {
      const configId = target.rollout.configId as string;

      if (!configCache.has(configId)) {
        configCache.set(
          configId,
          await this.prisma.config.findUnique({ where: { id: configId } }),
        );
      }
      const config = configCache.get(configId) ?? null;

      const problem = this.findProblem(config, device);
      if (problem) {
        await this.campaignRolloutService.recordTargetResult(
          deviceId,
          { configId },
          false,
          problem,
          target.rolloutId,
        );
        continue;
      }
      const validConfig = config as Config;

      const { fields } = await mergeApprovedOverride(
        this.prisma,
        deviceId,
        validConfig.id,
        validConfig.fields,
      );

      // ครั้งแรกที่งานถูกส่งเท่านั้น (คงเวลาแรกไว้) — ใช้แยก "ยังไม่มาดึง" กับ
      // "ดึงแล้วรอผล" และเลือกเครื่องที่ต้องได้ Config เก่าคืนตอน Rollback
      await this.prisma.campaignRolloutTarget.updateMany({
        where: { id: target.id, pulledAt: null, status: 'pending' },
        data: { pulledAt: new Date() },
      });

      response.jobs.push({
        jobId: target.id,
        rolloutId: target.rolloutId,
        createdAt: target.createdAt.toISOString(),
        payloadType: 'Config',
        config: {
          configId: validConfig.id,
          name: validConfig.name,
          deviceModel: validConfig.deviceModel,
          protocol: validConfig.protocol,
          fields,
        },
      });
    }

    return response;
  }

  /**
   * `POST /device-sync/{deviceId}/jobs/{jobId}/result` — อุปกรณ์รายงานผล
   *
   * **ส่งซ้ำได้ (idempotent)** ทุกกรณีที่ไม่บันทึกตอบ 200 พร้อม
   * `accepted: false` ไม่ใช่ error — มือถือเน็ตหลุดแล้วส่งซ้ำเป็นเรื่องปกติ
   * เครื่องจะได้หยุดส่งซ้ำ · `jobId` ที่ไม่ใช่ของเครื่องนี้หรือไม่ใช่งานที่เครื่อง
   * จัดการเอง 404 (ไม่บอกว่ามีอยู่จริงของเครื่องอื่นไหม)
   */
  async reportResult(
    deviceId: string,
    jobId: string,
    result: JobResult,
    detail?: string,
  ): Promise<JobReportResponse> {
    const target = await this.prisma.campaignRolloutTarget.findFirst({
      where: {
        id: jobId,
        deviceId,
        rollout: { payloadType: 'Config', applyMode: 'real' },
      },
      include: { rollout: true },
    });
    if (!target) {
      throw new NotFoundException('ไม่พบงานนี้ของอุปกรณ์เครื่องนี้');
    }

    if (target.status !== 'pending') {
      return { accepted: false, reason: 'already-reported' };
    }
    const rollout = target.rollout;
    if (
      !(ROLLOUT_OPEN_FOR_RESULT as readonly string[]).includes(rollout.status)
    ) {
      return { accepted: false, reason: 'rollout-closed' };
    }

    // รายงานผลโดยไม่เคยดึงงาน (เช่น เครื่องดึงไว้ก่อนแล้วระบบล้างข้อมูล หรือ
    // ส่งตรง) ตั้ง pulledAt ให้ครบ เพื่อให้ Rollback เห็นเครื่องนี้ถูกต้อง
    if (target.pulledAt === null) {
      await this.prisma.campaignRolloutTarget.updateMany({
        where: { id: target.id, pulledAt: null, status: 'pending' },
        data: { pulledAt: new Date() },
      });
    }

    const success = result === 'success';
    const message =
      detail && detail.trim() !== ''
        ? detail
        : success
          ? 'อุปกรณ์รายงานว่าใช้ Config สำเร็จ'
          : 'อุปกรณ์รายงานว่าใช้ Config ไม่สำเร็จ';

    const claimed = await this.campaignRolloutService.recordTargetResult(
      deviceId,
      { configId: rollout.configId as string },
      success,
      message,
      rollout.id,
    );
    return claimed
      ? { accepted: true }
      : { accepted: false, reason: 'already-reported' };
  }

  /** เหตุผลที่งานนี้ส่งให้อุปกรณ์ไม่ได้ (null = ส่งได้) — เงื่อนไขเดียวกับ
   * `autoApplyConfig()` ของโหมด `mock` */
  private findProblem(
    config: Config | null,
    device: { status: string; deviceModel: string; protocol: string } | null,
  ): string | null {
    if (!config) return 'ไม่พบ Config ของ Rollout นี้';
    if (
      config.deletedAt !== null ||
      !APPLICABLE_CONFIG_STATUSES.includes(config.status)
    ) {
      return `Config สถานะปัจจุบัน (${config.status}${config.deletedAt ? ', ถูกลบไปแล้ว' : ''}) ใช้งานไม่ได้อีกต่อไป`;
    }
    if (!device) return 'ไม่พบอุปกรณ์';
    if (device.status !== TARGETABLE_DEVICE_STATUS) {
      return `Device สถานะปัจจุบัน (${device.status}) ไม่ใช่ ${TARGETABLE_DEVICE_STATUS} อีกต่อไป`;
    }
    if (
      config.deviceModel !== device.deviceModel ||
      config.protocol !== device.protocol
    ) {
      return `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับอุปกรณ์ ${device.deviceModel}/${device.protocol}`;
    }
    return null;
  }
}
