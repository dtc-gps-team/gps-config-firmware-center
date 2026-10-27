import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Incident, Prisma } from '@prisma/client';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import {
  maxSeverity,
  ROLLOUT_FAILED_EVENT,
  ROLLOUT_RESULT_UPDATED_EVENT,
  ROLLOUT_STATUS_CHANGED_EVENT,
  RolloutEvents,
  type RolloutFailedEvent,
  type RolloutResultUpdatedEvent,
  type RolloutStatusChangedEvent,
} from '../campaign/rollout-events';
import { FIELD_APPLY_SYSTEM_CAMPAIGN_NAME } from '../campaign/field-apply-system-campaign';
import {
  ConfigSyncFailure,
  ConfigSyncSuccess,
  ConfigSyncWriterQueue,
} from '../config-sync-writer/config-sync-writer-queue.service';
import { toLegacyFields } from '../config-sync-writer/legacy-fields';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { DecideIncidentDto } from './dto/decide-incident.dto';
import { QueryIncidentDto } from './dto/query-incident.dto';
import { INCIDENT_SOURCE, IncidentMetadata } from './incident-metadata';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
  /** มาจาก `req.ip` ที่ controller แนบมาด้วย (docs §13.3 Audit Log ระบุ IP
   * Address เป็น field ที่ต้องเก็บ) — optional mirror `config.service.ts` */
  ipAddress?: string | null;
}

/** ผลของ `decide()` — `device` มีค่าเฉพาะตอน outcome `promote` **และ**
 * incident นี้มี `deviceId` ผูกอยู่จริง (อุปกรณ์เครื่องนั้นต้องยังมีอยู่จริง
 * ด้วย — ถ้าถูกปลดระวาง/ลบไปแล้วจะเป็น `null`) ให้ Operation เอา
 * `deviceModel`/`protocol` ไปกรอกต่อในหน้า Campaign Wizard ได้ทันทีไม่ต้อง
 * เปิดหา Device เอง — **ไม่มี field แนะนำ Config/Firmware** ตามที่ตกลงไว้ว่า
 * ไม่เดาให้ (ดู comment เหนือ `DecideIncidentDto`) */
export type DecideIncidentResult = Incident & {
  device: { deviceId: string; deviceModel: string; protocol: string } | null;
};

/** AuditLog.auditModule ของแถวที่โมดูลนี้เขียน (issue #236 — ก่อนหน้านี้โมดูล
 * นี้ไม่เคยเขียน AuditLog เลยเพราะเป็น read-only ล้วน) */
const AUDIT_MODULE = 'incident';

/** Role ที่เห็น field report ของ "ทุกคน" ได้ (ไม่ถูก self-scope) — ตรงกับ
 * ขอบเขตเดิมของ `incidents` resource (R ทุก Role) ยกเว้น ST/OT ที่ต้องเห็น
 * เฉพาะของตัวเอง (IDOR Prevention Pattern, ตามรีวิว B บน issue #236) —
 * mirror `UNSCOPED_TASK_ROLES` ของ task.service.ts ทุกประการ (allowlist
 * default-deny ไม่ใช่ denylist default-allow — role ใหม่ที่ได้ grant
 * `incidents.Read` ทีหลังโดยไม่ตั้งใจจะ fallback เป็น self-scoped เสมอ)
 * — ใช้กับ**เฉพาะ** incident ที่ `source: 'field-report'` เท่านั้น
 * incident auto-detect เดิม (config-sync-writer/mobile-simulator-test)
 * ทุก Role เห็นเหมือนเดิมไม่เปลี่ยนแปลง */
const UNSCOPED_INCIDENT_ROLES: readonly string[] = [
  'ConfigEngineer',
  'FirmwareEngineer',
  'QAEngineer',
  'Operation',
  'Auditor',
  'Admin',
  'SuperAdmin',
];

/**
 * incident module (ฝั่ง A):
 *   1. สร้าง Incident อัตโนมัติเมื่อ config-sync-writer เขียนไม่สำเร็จ
 *      (`createFromSyncFailure`, listener — มติที่ประชุม #32, docs/07 §9.5/§5)
 *   2. read-only endpoint `GET /incidents` + `GET /incidents/:id`
 *      (`findAllIncidents` / `findIncidentById` — Sprint 2)
 *   3. Field Incident Report (issue #236) — ST/OT แจ้งปัญหาเองผ่าน Mobile
 *      (`createFieldReport`) + Operation ตัดสินใจ (`decide`)
 *
 * ฟัง event `'sync-failed'` จาก `ConfigSyncWriterQueue` — B มี listener แยก
 * ของตัวเอง (`incident_alert` notification) คนละ PR โดยไม่ต้องแตะไฟล์นี้
 */
/** ข้อความ description ของ Incident จาก Rollout — ใช้ร่วมกันตอนสร้าง/อัปเดตจาก
 * `rollout-failed` และตอนอัปเดตเฉพาะตัวเลขจาก `rollout-result-updated`
 * เพื่อให้รูปแบบเดียวกันเสมอ */
function rolloutIncidentDescription(
  event: Pick<
    RolloutFailedEvent,
    | 'campaignName'
    | 'rolloutId'
    | 'failureCount'
    | 'targetCount'
    | 'skippedCount'
    | 'sampleErrors'
  >,
): string {
  const failureRate =
    event.targetCount > 0 ? event.failureCount / event.targetCount : 0;
  return (
    `Campaign "${event.campaignName}" Rollout ${event.rolloutId}: ` +
    `ล้มเหลว ${event.failureCount} จาก ${event.targetCount} เครื่อง ` +
    `(${(failureRate * 100).toFixed(1)}%)` +
    (event.skippedCount > 0
      ? ` · ข้ามเพราะออฟไลน์ ${event.skippedCount} เครื่อง`
      : '') +
    (event.sampleErrors.length > 0
      ? ` · ตัวอย่างข้อผิดพลาด: ${event.sampleErrors.join(' / ')}`
      : '')
  );
}

/**
 * ชื่อ/รายละเอียด Incident ของ Rollout เครื่องเดียวจากคำขอส่งเข้ากล่องจากหน้างาน
 * (docs/27 §8, กลับมติ Q4 ของ docs/25 — เดิมไม่สร้าง Incident เพราะยังไม่มี
 * hook อัปเดต `ConfigApplyRequest` ตอนนั้น ตอนนี้มีแล้ว) — ไม่ใช้คำว่า
 * "Campaign"/เปอร์เซ็นต์เหมือน `rolloutIncidentDescription()` เพราะมีเครื่อง
 * เดียวเสมอ บอกตรงๆ ว่าเครื่องไหนและทำไมถึงไม่สำเร็จ (ข้อความจาก §7.2)
 */
function fieldApplyIncidentTitle(
  event: Pick<RolloutFailedEvent, 'kind' | 'failedDeviceIds'>,
): string {
  const deviceId = event.failedDeviceIds[0] ?? 'ไม่ทราบเครื่อง';
  return event.kind === 'completed-with-skipped'
    ? `คำขอส่งเข้ากล่องจากหน้างานส่งไม่ถึง (กล่องออฟไลน์): ${deviceId}`
    : `คำขอส่งเข้ากล่องจากหน้างานล้มเหลว: ${deviceId}`;
}

function fieldApplyIncidentDescription(
  event: Pick<RolloutFailedEvent, 'rolloutId' | 'sampleErrors'>,
): string {
  const detail = event.sampleErrors[0];
  return (
    `คำขอส่ง Config/Firmware จากหน้างานเข้าเครื่องนี้ไม่สำเร็จ` +
    (detail ? ` — ${detail}` : '') +
    ` (Rollout ${event.rolloutId})`
  );
}

@Injectable()
export class IncidentService implements OnModuleInit {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configSyncQueue: ConfigSyncWriterQueue,
    private readonly notificationService: NotificationService,
    // event ของ Campaign Rollout (docs/19 §15.5) — A เป็นเจ้าของทั้งฝั่งส่ง
    // (campaign) และฝั่งฟัง (ที่นี่) ส่วน notification (B) ฟังคนละโมดูล
    private readonly rolloutEvents: RolloutEvents,
  ) {}

  onModuleInit(): void {
    // listener ต้อง self-contain error handling เอง — `emit()` เป็น sync ไม่
    // await ผล (review #131 ข้อ 2) · `createFromSyncFailure` never-throws อยู่
    // แล้ว จึงห่อด้วย `void` ตรงๆ ได้ ไม่มี rejection หลุดออกมาเป็น
    // unhandledRejection
    this.configSyncQueue.on('sync-failed', (failure: ConfigSyncFailure) => {
      void this.createFromSyncFailure(failure);
    });
    this.logger.log("ผูก listener 'sync-failed' ของ config-sync-writer แล้ว");
    // เขียน Config สำเร็จ (รวมที่ Operation สั่งลองเขียนใหม่) -> ปิด Incident ที่ค้าง
    // ของ Config เดียวกันให้เอง (never-throw เหมือน listener ข้างบน)
    this.configSyncQueue.on('sync-succeeded', (success: ConfigSyncSuccess) => {
      void this.resolveFromSyncSuccess(success);
    });

    // handler ทั้งสองไม่ throw (never-throw) จึงห่อ `void` ได้เหมือนข้างบน
    this.rolloutEvents.on(ROLLOUT_FAILED_EVENT, (event: RolloutFailedEvent) => {
      void this.handleRolloutFailed(event);
    });
    this.rolloutEvents.on(
      ROLLOUT_STATUS_CHANGED_EVENT,
      (event: RolloutStatusChangedEvent) => {
        void this.handleRolloutStatusChanged(event);
      },
    );
    this.rolloutEvents.on(
      ROLLOUT_RESULT_UPDATED_EVENT,
      (event: RolloutResultUpdatedEvent) => {
        void this.handleRolloutResultUpdated(event);
      },
    );
    this.logger.log("ผูก listener 'rollout-failed' ของ Campaign Rollout แล้ว");
  }

  /**
   * สร้างหรืออัปเดต Incident จาก Rollout ที่เข้า Auto Pause หรือจบแต่มีเครื่อง
   * ที่ไม่สำเร็จ / ถูกข้าม (docs/19 §15.2 ถึง §15.3) — never-throws
   *
   * **1 Rollout มีได้ 1 Incident**: หยุดเองหลายรอบหรือหยุดแล้วจบทีหลังอัปเดต
   * Incident เดิม (ตัวเลข, severity เป็นค่าที่สูงกว่า) และเปลี่ยนสถานะกลับเป็น
   * `open` ไม่สร้างใหม่ · การสร้างโดยระบบไม่ลง AuditLog (เหมือน Incident
   * อัตโนมัติจาก config-sync-writer) ส่วนการ Resume/Rollback ของ Operation
   * ลงครบที่โมดูล campaign อยู่แล้ว
   */
  async handleRolloutFailed(event: RolloutFailedEvent): Promise<void> {
    // docs/27 §8 — กลับมติ Q4 ของ docs/25 §3.5 ข้อ 4: ตอนนั้นไม่สร้าง Incident
    // ให้ Rollout เครื่องเดียวของคำขอส่งเข้ากล่องจากหน้างานเพราะยังไม่มี hook
    // อัปเดต `ConfigApplyRequest` ให้ผู้ขอรู้ผลเอง — ตอนนี้มีแล้ว
    // (`FIELD_APPLY_RESULT_EVENT`) แต่ Operation ที่อนุมัติก็ควรเห็นว่าคำขอที่
    // ตัวเองอนุมัติไปไม่สำเร็จด้วย ไม่ใช่รู้แค่ฝั่งช่าง — สร้าง Incident ให้
    // เหมือน Rollout ทั่วไป แค่ชื่อ/คำอธิบายเจาะจงเครื่องเดียว ไม่ใช้คำว่า
    // "Campaign"/เปอร์เซ็นต์ (ดู `fieldApplyIncidentTitle`/`...Description`)
    const isFieldApply =
      event.campaignName === FIELD_APPLY_SYSTEM_CAMPAIGN_NAME;
    try {
      const metadata: IncidentMetadata = {
        rolloutId: event.rolloutId,
        campaignId: event.campaignId,
        kind: event.kind,
        failureCount: event.failureCount,
        skippedCount: event.skippedCount,
        targetCount: event.targetCount,
        failedDeviceIds: event.failedDeviceIds,
        sampleErrors: event.sampleErrors,
      };
      const title = isFieldApply
        ? fieldApplyIncidentTitle(event)
        : event.kind === 'auto-pause'
          ? `Rollout หยุดอัตโนมัติ: ${event.campaignName}`
          : `Rollout จบแต่มีเครื่องที่ไม่สำเร็จ: ${event.campaignName}`;
      const description = isFieldApply
        ? fieldApplyIncidentDescription(event)
        : rolloutIncidentDescription(event);
      // ผูก Device (docs/27 §8) — มีเครื่องเดียวเสมอสำหรับ field-apply
      const deviceId = isFieldApply ? (event.failedDeviceIds[0] ?? null) : null;

      const existing = await this.findRolloutIncident(event.rolloutId);
      if (existing) {
        await this.prisma.incident.update({
          where: { id: existing.id },
          data: {
            title,
            description,
            severity: maxSeverity(existing.severity, event.severity),
            status: 'open',
            deviceId: deviceId ?? existing.deviceId,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
        this.logger.warn(
          `อัปเดต Incident ${existing.id} — Rollout ${event.rolloutId} (${event.kind})`,
        );
        return;
      }

      const incident = await this.prisma.incident.create({
        data: {
          title,
          description,
          severity: event.severity,
          status: 'open',
          relatedConfigId: event.configId,
          relatedFirmwareId: event.firmwareId,
          deviceId,
          source: INCIDENT_SOURCE.rolloutFailure,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      this.logger.warn(
        `สร้าง Incident ${incident.id} — Rollout ${event.rolloutId} (${event.kind})`,
      );
    } catch (err) {
      this.logger.error(
        `สร้าง Incident จาก 'rollout-failed' ไม่สำเร็จ (rollout ${event.rolloutId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * อัปเดต**ตัวเลข**ใน Incident เดิมของ Rollout เมื่อผลของเครื่องในรอบที่จบหรือ
   * หยุดไปแล้วเปลี่ยน เช่น เครื่องที่ถูกข้ามกลับมารายงานผลล่าช้า (docs/19
   * §15.4 แถวสุดท้าย, §16.4) — never-throws
   *
   * ต่างจาก `handleRolloutFailed` โดยตั้งใจ (แก้ตามรีวิว B บน #337):
   *   - **ไม่แตะ `status`** Incident ที่ Operation ตัดสินแล้ว (`investigating`,
   *     `resolved`, `dismissed`, `rolled_back`) ต้องไม่ถูกเปิดกลับเป็น `open`
   *     เพราะมีเครื่องทยอยกลับมารายงาน และ Incident ที่ปิดสะอาดแล้วไม่ถูกปิดเอง
   *     เพิ่ม (Operation ปิดเอง)
   *   - **ไม่สร้าง Incident ใหม่** ไม่มี Incident ของ Rollout นี้ก็ไม่ทำอะไร
   *   - คง `title` / `kind` เดิม และ severity ใช้ค่าที่สูงกว่า ไม่ลดระดับ
   */
  async handleRolloutResultUpdated(
    event: RolloutResultUpdatedEvent,
  ): Promise<void> {
    try {
      const existing = await this.findRolloutIncident(event.rolloutId);
      if (!existing) return;

      const previous =
        existing.metadata &&
        typeof existing.metadata === 'object' &&
        !Array.isArray(existing.metadata)
          ? (existing.metadata as IncidentMetadata)
          : {};
      const metadata: IncidentMetadata = {
        ...previous,
        failureCount: event.failureCount,
        skippedCount: event.skippedCount,
        targetCount: event.targetCount,
        failedDeviceIds: event.failedDeviceIds,
        sampleErrors: event.sampleErrors,
      };
      await this.prisma.incident.update({
        where: { id: existing.id },
        data: {
          description: rolloutIncidentDescription(event),
          severity: maxSeverity(existing.severity, event.severity),
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `อัปเดตตัวเลข Incident จาก Rollout ${event.rolloutId} ไม่สำเร็จ: ${(err as Error).message}`,
      );
    }
  }

  /**
   * ปรับสถานะ Incident ของ Rollout ตามการตัดสินใจของ Operation / ผลของ Rollout
   * (docs/19 §15.4) — never-throws · ไม่มี Incident ของ Rollout นี้ก็ไม่ทำอะไร
   *   resumed         open -> investigating
   *   rolled-back     -> rolled_back
   *   completed-clean open/investigating -> resolved พร้อมหมายเหตุปิดอัตโนมัติ
   *                   (ไม่ทับ rolled_back/dismissed ที่ Operation ตัดสินแล้ว)
   */
  async handleRolloutStatusChanged(
    event: RolloutStatusChangedEvent,
  ): Promise<void> {
    try {
      const incident = await this.findRolloutIncident(event.rolloutId);
      if (!incident) return;

      if (event.action === 'rolled-back') {
        await this.prisma.incident.update({
          where: { id: incident.id },
          data: { status: 'rolled_back' },
        });
        return;
      }
      if (event.action === 'resumed') {
        if (incident.status === 'open') {
          await this.prisma.incident.update({
            where: { id: incident.id },
            data: { status: 'investigating' },
          });
        }
        return;
      }
      // completed-clean
      if (incident.status === 'open' || incident.status === 'investigating') {
        await this.prisma.incident.update({
          where: { id: incident.id },
          data: {
            status: 'resolved',
            description: `${incident.description ?? ''}${incident.description ? ' · ' : ''}ปิดอัตโนมัติ: Rollout เสร็จสิ้น ไม่มีเครื่องล้มหรือถูกข้ามในรอบหลัง Resume`,
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `ปรับสถานะ Incident จาก Rollout ${event.rolloutId} ไม่สำเร็จ: ${(err as Error).message}`,
      );
    }
  }

  /** Incident ของ Rollout นี้ (1 Rollout ต่อ 1 Incident) — หาจาก `metadata.rolloutId` */
  private findRolloutIncident(rolloutId: string): Promise<Incident | null> {
    return this.prisma.incident.findFirst({
      where: {
        source: INCIDENT_SOURCE.rolloutFailure,
        metadata: { path: ['rolloutId'], equals: rolloutId },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * สร้าง Incident 1 รายการจากความล้มเหลวถาวรของ config-sync — never-throws
   * (mirror `task.service.ts` notifyTaskAssigned) · error ในนี้ห้ามทะลุกลับไป
   * ที่ queue
   */
  async createFromSyncFailure(failure: ConfigSyncFailure): Promise<void> {
    try {
      // FK `relatedConfigId` ใช้ผูก relation ตามปกติ — ไม่ต้องซ้ำ `configId` ใน
      // metadata (ดู comment ใน incident-metadata.ts) · metadata เก็บเฉพาะส่วน
      // ที่ไม่มี column จริง
      const metadata: IncidentMetadata = {
        versionNumber: failure.versionNumber,
        attempts: failure.attempts,
        lastError: failure.lastError,
      };
      // เวอร์ชันเดียวกันของ Config เดียวกันที่ยังมี Incident ค้างอยู่ (เช่น Operation
      // สั่งลองเขียนใหม่แล้วล้มอีก) -> อัปเดตของเดิม ไม่สร้างซ้ำเป็นรายการที่สอง
      const active = await this.prisma.incident.findFirst({
        where: {
          source: INCIDENT_SOURCE.configSyncWriter,
          relatedConfigId: failure.configId,
          status: { in: ['open', 'investigating'] },
          metadata: { path: ['versionNumber'], equals: failure.versionNumber },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (active) {
        const previous = (active.metadata ?? {}) as IncidentMetadata;
        const totalAttempts = (previous.attempts ?? 0) + failure.attempts;
        await this.prisma.incident.update({
          where: { id: active.id },
          data: {
            status: 'open',
            description:
              `config-sync-writer เขียน Config ${failure.configId} ` +
              `(${failure.deviceModel}/${failure.protocol}) เข้า config.dtc.co.th:909 ` +
              `ไม่สำเร็จ รวม ${totalAttempts} ครั้ง — ${failure.lastError}`,
            metadata: {
              ...metadata,
              attempts: totalAttempts,
            } as Prisma.InputJsonValue,
          },
        });
        this.logger.warn(
          `อัปเดต Incident ${active.id} — config-sync ล้มเหลวซ้ำ (config ${failure.configId} v${failure.versionNumber})`,
        );
        return;
      }
      const incident = await this.prisma.incident.create({
        data: {
          title: `เขียน Config เข้าระบบเดิมไม่สำเร็จ (v${failure.versionNumber})`,
          description:
            `config-sync-writer เขียน Config ${failure.configId} ` +
            `(${failure.deviceModel}/${failure.protocol}) เข้า config.dtc.co.th:909 ` +
            `ไม่สำเร็จหลัง retry ${failure.attempts} ครั้ง — ${failure.lastError}`,
          severity: 'high',
          status: 'open',
          relatedConfigId: failure.configId,
          source: INCIDENT_SOURCE.configSyncWriter,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      this.logger.warn(
        `สร้าง Incident ${incident.id} — config-sync ล้มเหลว ` +
          `(config ${failure.configId} v${failure.versionNumber})`,
      );
    } catch (err) {
      this.logger.error(
        `สร้าง Incident จาก 'sync-failed' ไม่สำเร็จ (config ${failure.configId}): ` +
          `${(err as Error).message}`,
      );
    }
  }

  /**
   * เขียน Config เข้าระบบปลายทางสำเร็จ -> ปิด Incident เขียน Config ที่ค้างอยู่ของ
   * Config เดียวกันให้เอง (status `resolved` พร้อมหมายเหตุ ไม่มีผู้ปิดเพราะระบบทำ)
   * · ปิดเฉพาะ Incident ของเวอร์ชันเดียวกันหรือเก่ากว่า: เวอร์ชันใหม่เขียนผ่านแปลว่า
   * ค่าเก่าถูกแทนที่แล้ว แต่เวอร์ชันเก่าเขียนผ่านไม่ได้แปลว่าเวอร์ชันใหม่ที่ค้างอยู่
   * ผ่านด้วย · never-throws
   */
  async resolveFromSyncSuccess(success: ConfigSyncSuccess): Promise<void> {
    try {
      const active = await this.prisma.incident.findMany({
        where: {
          source: INCIDENT_SOURCE.configSyncWriter,
          relatedConfigId: success.configId,
          status: { in: ['open', 'investigating'] },
        },
      });
      const ids = active
        .filter((incident) => {
          const version = (incident.metadata as IncidentMetadata | null)
            ?.versionNumber;
          return (
            typeof version !== 'number' || version <= success.versionNumber
          );
        })
        .map((incident) => incident.id);
      if (ids.length === 0) return;

      const result = await this.prisma.incident.updateMany({
        where: { id: { in: ids }, status: { in: ['open', 'investigating'] } },
        data: {
          status: 'resolved',
          reviewedAt: new Date(),
          reviewNote: 'ปิดอัตโนมัติ: เขียน Config เข้าระบบปลายทางสำเร็จภายหลัง',
        },
      });
      this.logger.log(
        `ปิด Incident ${result.count} รายการอัตโนมัติ — config ${success.configId} v${success.versionNumber} เขียนสำเร็จ`,
      );
    } catch (err) {
      this.logger.error(
        `ปิด Incident จาก 'sync-succeeded' ไม่สำเร็จ (config ${success.configId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * `POST /incidents/:id/retry-sync` — Operation สั่งเขียน Config เข้าระบบปลายทาง
   * ใหม่ จาก Incident ที่เกิดจากการเขียน Config ไม่สำเร็จ (`config-sync-writer`)
   * resource `incidents` action `Approve` (ตัวเดียวกับ `decide`)
   *
   * เขียนจาก snapshot ของเวอร์ชันที่อนุมัติไว้ (`ConfigVersion`) ไม่ใช่ค่าปัจจุบันของ
   * Config จึงได้ค่าที่อนุมัติจริงเสมอ · fire-and-forget เหมือนตอน approve: ตอบทันที
   * ว่าสั่งแล้ว (status เป็น `investigating`) ผลจริงมาทาง event: สำเร็จ -> ปิดอัตโนมัติ
   * (`resolveFromSyncSuccess`), ล้มอีก -> อัปเดต Incident เดิมกลับเป็น `open` แล้ว
   * สั่งใหม่ได้อีก
   *
   * **รับเฉพาะสถานะ `open`**: `investigating` หมายถึงสั่งเขียนไปแล้วและกำลังรอผล ถ้ารับ
   * ด้วยจะเข้าคิวเขียนซ้ำได้เมื่อกดซ้ำหรือ Operation สองคนกดพร้อมกัน (ตอนต่อระบบจริงจะ
   * เขียนซ้ำจริง) และ claim ด้วย `updateMany` ระบุสถานะ `open` เพื่อให้คนที่สองแพ้การแข่ง
   *
   * 404 ไม่พบ Incident หรือไม่พบเวอร์ชันของ Config · 400 ไม่ใช่ Incident เขียน Config
   * หรือไม่มีข้อมูลเวอร์ชันพอให้เขียนซ้ำ · 409 ปิดไปแล้วหรือกำลังลองเขียนอยู่
   */
  async retrySync(id: string, actor: ActingUser): Promise<Incident> {
    const existing = await this.prisma.incident.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`ไม่พบ Incident id ${id}`);
    }
    if (existing.source !== INCIDENT_SOURCE.configSyncWriter) {
      throw new BadRequestException(
        'ลองเขียนใหม่ได้เฉพาะ Incident ที่เกิดจากการเขียน Config เข้าระบบปลายทางไม่สำเร็จ',
      );
    }
    if (existing.status === 'investigating') {
      throw new ConflictException(
        'Incident นี้กำลังลองเขียนอยู่แล้ว กรุณารอผลก่อน (ถ้าล้มเหลวอีกจะกลับเป็นเปิดและสั่งใหม่ได้)',
      );
    }
    if (existing.status !== 'open') {
      throw new ConflictException(
        `Incident นี้ปิดไปแล้ว (สถานะปัจจุบัน: ${existing.status})`,
      );
    }
    const versionNumber = (existing.metadata as IncidentMetadata | null)
      ?.versionNumber;
    if (!existing.relatedConfigId || typeof versionNumber !== 'number') {
      throw new BadRequestException(
        'Incident นี้ไม่มีข้อมูล Config และเวอร์ชันที่ต้องเขียน จึงลองเขียนใหม่ไม่ได้',
      );
    }
    const version = await this.prisma.configVersion.findUnique({
      where: {
        configId_versionNumber: {
          configId: existing.relatedConfigId,
          versionNumber,
        },
      },
    });
    if (!version) {
      throw new NotFoundException(
        `ไม่พบ Config เวอร์ชัน ${versionNumber} ของ Incident นี้`,
      );
    }

    // claim เฉพาะที่ยัง `open`: คำขอที่มาพร้อมกันอีกใบจะได้ count 0 และไม่เข้าคิวเขียนซ้ำ
    const updated = await this.prisma.incident.updateMany({
      where: { id, status: 'open' },
      data: { status: 'investigating' },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        `Incident id ${id} ถูกคำขออื่นสั่งเขียนหรือปิดไปแล้วระหว่างที่ทำรายการ`,
      );
    }

    const metadata: AuditLogMetadata = {
      incidentId: id,
      incidentSource: INCIDENT_SOURCE.configSyncWriter,
    };
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'retry-sync',
          metadata: metadata as Prisma.InputJsonValue,
          ipAddress: actor.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action retry-sync, user ${actor.id}): ${(err as Error).message}`,
      );
    }

    this.configSyncQueue.enqueueConfigSync({
      configId: existing.relatedConfigId,
      versionNumber,
      deviceModel: version.deviceModel,
      protocol: version.protocol,
      fields: toLegacyFields(version.fields),
    });

    return { ...existing, status: 'investigating' };
  }

  /**
   * รายการ Incident ทั้งหมด (read-only) — resource `incidents` action `Read`
   * grant ให้ทุก role (RBAC_Matrix.md แถว "Incident & Rollback" = R ทุก role) ·
   * เรียงตาม `createdAt desc` (ใหม่สุดก่อน) · ไม่มี paging ตาม MVP เดียวกับ
   * `devices` (จำนวนข้อมูลน้อย)
   *
   * **self-scope สำหรับ field report (issue #236, แก้ตามรีวิว B)** — ST/OT
   * เห็นเฉพาะ field report ของตัวเอง (`reportedBy` ตรงกับ actor) ส่วน
   * incident auto-detect เดิม (`source` อื่น) ทุก Role เห็นเหมือนเดิมไม่
   * เปลี่ยน — mirror `TaskService.findAll()` ทุกประการ (`UNSCOPED_INCIDENT_ROLES`
   * allowlist, ไม่ใช่ denylist)
   */
  findAllIncidents(
    query: QueryIncidentDto,
    actor: ActingUser,
  ): Promise<Incident[]> {
    const { status, relatedConfigId, relatedFirmwareId } = query;
    const scopeFilter: Prisma.IncidentWhereInput =
      UNSCOPED_INCIDENT_ROLES.includes(actor.role)
        ? {}
        : {
            OR: [
              { source: { not: INCIDENT_SOURCE.fieldReport } },
              { reportedBy: actor.id },
            ],
          };
    return this.prisma.incident.findMany({
      where: {
        AND: [
          scopeFilter,
          {
            status: status || undefined,
            relatedConfigId: relatedConfigId || undefined,
            relatedFirmwareId: relatedFirmwareId || undefined,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Incident 1 รายการตาม id — 404 ถ้าไม่พบ**หรือถูกซ่อนจาก actor**
   * (mirror `TaskService.findOne()` — ST/OT ที่ไม่ใช่เจ้าของ field report
   * ได้ 404 แทน 403 กันเปิดเผยว่ามี record นี้อยู่ ตาม IDOR Prevention
   * Pattern ใน CLAUDE.md) */
  async findIncidentById(id: string, actor: ActingUser): Promise<Incident> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident || this.isHiddenFromActor(incident, actor)) {
      throw new NotFoundException(`ไม่พบ Incident id ${id}`);
    }
    return incident;
  }

  private isHiddenFromActor(incident: Incident, actor: ActingUser): boolean {
    if (UNSCOPED_INCIDENT_ROLES.includes(actor.role)) return false;
    if (incident.source !== INCIDENT_SOURCE.fieldReport) return false;
    return incident.reportedBy !== actor.id;
  }

  /**
   * `POST /incidents` (issue #236) — ST/OT แจ้งปัญหาที่เจอกับอุปกรณ์ผ่าน
   * Mobile resource `incidents` action `Create` (ใหม่ — เดิมมีแค่ `Read`)
   * `status` fix เป็น `open` เสมอ (ค่า default ของ schema อยู่แล้ว) —
   * แจ้งเตือน Operation ทุกคนว่ามี report ใหม่ (never-throw — การแจ้งเตือน
   * ล้มเหลวไม่ควรทำให้สร้าง report ไม่สำเร็จ)
   */
  async createFieldReport(
    dto: CreateIncidentDto,
    actor: ActingUser,
  ): Promise<Incident> {
    const incident = await this.prisma.incident.create({
      data: {
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
        deviceId: dto.deviceId,
        source: INCIDENT_SOURCE.fieldReport,
        reportedBy: actor.id,
      },
    });

    const metadata: AuditLogMetadata = {
      incidentId: incident.id,
      deviceId: incident.deviceId ?? undefined,
    };
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'report',
          metadata: metadata as Prisma.InputJsonValue,
          ipAddress: actor.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action report, user ${actor.id}): ${(err as Error).message}`,
      );
    }

    await this.notifyOperationOfPendingReport(incident);

    return incident;
  }

  /**
   * `POST /incidents/:id/decide` (issue #236) — Operation ตัดสินใจ field
   * report ที่ยังเป็น `open` resource `incidents` action `Approve` (ไม่สร้าง
   * action ใหม่ — `ActionType` เป็น Prisma enum จริง เพิ่มค่าใหม่ต้อง
   * migration เปล่าๆ โดยไม่จำเป็น ทุกจุดที่ Operation ตัดสินใจในระบบนี้ใช้
   * `Approve` ตัวเดียวกันอยู่แล้วไม่ว่าผลจะเป็นอนุมัติหรือปฏิเสธ — mirror
   * `campaign-rollout.controller.ts`/`device-config-override.controller.ts`)
   *
   * ใช้ได้กับ Incident 2 กลุ่ม:
   *   - field report (`source: 'field-report'`): ต้องเป็น `open` · ได้ทั้ง 3
   *     outcome (resolve/dismiss/promote)
   *   - Incident ที่ระบบสร้างเอง (rollout-failure, config-sync-writer ฯลฯ):
   *     ต้องเป็น `open` หรือ `investigating` · ปิดด้วยมือได้เฉพาะ `resolve`/
   *     `dismiss` (`promote` ไม่รองรับ — Rollout มีทาง Rollback ของตัวเองอยู่
   *     แล้ว) · ใช้เมื่อระบบปิดให้เองไม่ได้ เช่น Rollout จบแต่มีเครื่องล้มและ
   *     ไม่มีใคร resume · ไม่มีผู้รายงานจึงไม่ส่ง notification
   *
   * 404 ถ้าไม่พบ, 409 ถ้าปิด/ตัดสินใจไปแล้ว (mirror `getPendingOverrideOrThrow()`)
   * · ปิดแล้วไม่เปิดคืนเอง ยกเว้น Rollout เดิมล้มซ้ำ (`handleRolloutFailed`)
   */
  async decide(
    id: string,
    dto: DecideIncidentDto,
    actor: ActingUser,
  ): Promise<DecideIncidentResult> {
    const existing = await this.getDecidableIncidentOrThrow(id, dto.outcome);
    const isFieldReport = existing.source === INCIDENT_SOURCE.fieldReport;

    const status =
      dto.outcome === 'resolve'
        ? 'resolved'
        : dto.outcome === 'dismiss'
          ? 'dismissed'
          : 'investigating';

    const reviewedAt = new Date();
    const result = await this.prisma.incident.updateMany({
      where: isFieldReport
        ? { id, status: 'open' }
        : { id, status: { in: ['open', 'investigating'] } },
      data: {
        status,
        reviewedBy: actor.id,
        reviewedAt,
        reviewNote: dto.note,
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        `Incident id ${id} ถูกตัดสินใจไปแล้วโดยคำขออื่นที่เกิดขึ้นพร้อมกัน`,
      );
    }

    const metadata: AuditLogMetadata = {
      incidentId: id,
      outcome: dto.outcome,
      // การปิด Incident ที่ระบบสร้างเองด้วยมือ: บันทึกที่มาไว้ให้ตรวจย้อนหลัง
      ...(isFieldReport
        ? {}
        : { incidentSource: existing.source ?? 'unknown' }),
    };
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'decide',
          metadata: metadata as Prisma.InputJsonValue,
          ipAddress: actor.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action decide, user ${actor.id}): ${(err as Error).message}`,
      );
    }

    const decided: Incident = {
      ...existing,
      status,
      reviewedBy: actor.id,
      reviewedAt,
      reviewNote: dto.note,
    };
    await this.notifyReporterOfDecision(decided, dto.outcome);

    // promote เท่านั้นที่ Operation ต้องใช้ deviceModel/protocol ต่อใน
    // Campaign Wizard — เคสอื่นไม่ต้อง query Device เพิ่มโดยไม่จำเป็น
    const device =
      dto.outcome === 'promote' && decided.deviceId
        ? await this.prisma.device.findUnique({
            where: { deviceId: decided.deviceId },
            select: { deviceId: true, deviceModel: true, protocol: true },
          })
        : null;

    return { ...decided, device };
  }

  /** หา Incident ที่ตัดสินใจ/ปิดได้ — 404 ไม่พบ, 400 ถ้าขอ `promote` กับ Incident
   * ที่ระบบสร้างเอง, 409 ถ้าตัดสินใจ/ปิดไปแล้ว (mirror `getPendingOverrideOrThrow()`
   * ของ Device Config Override) */
  private async getDecidableIncidentOrThrow(
    id: string,
    outcome: DecideIncidentDto['outcome'],
  ): Promise<Incident> {
    const existing = await this.prisma.incident.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`ไม่พบ Incident id ${id}`);
    }
    if (existing.source === INCIDENT_SOURCE.fieldReport) {
      if (existing.status !== 'open') {
        throw new ConflictException(
          `Incident นี้ถูกตัดสินใจไปแล้ว (สถานะปัจจุบัน: ${existing.status})`,
        );
      }
      return existing;
    }

    if (outcome === 'promote') {
      throw new BadRequestException(
        'ส่งต่อเป็น Campaign ได้เฉพาะ field report ที่ช่างแจ้งจากหน้างาน ' +
          'Incident ที่ระบบสร้างเองปิดได้ด้วย resolve หรือ dismiss เท่านั้น',
      );
    }
    if (existing.status !== 'open' && existing.status !== 'investigating') {
      throw new ConflictException(
        `Incident นี้ปิดไปแล้ว (สถานะปัจจุบัน: ${existing.status})`,
      );
    }
    return existing;
  }

  /** แจ้ง Operation ทุกคนว่ามี field report ใหม่รอตัดสินใจ — never-throw
   * (mirror `notifyOperationOfPendingOverride()` ของ Device Config Override) */
  private async notifyOperationOfPendingReport(
    incident: Incident,
  ): Promise<void> {
    try {
      const operations = await this.prisma.user.findMany({
        where: { role: { code: 'Operation' }, isActive: true },
        select: { id: true },
      });
      for (const operation of operations) {
        await this.notificationService.send({
          userId: operation.id,
          type: 'incident_report_pending',
          payload: {
            incidentId: incident.id,
            deviceId: incident.deviceId,
            title: incident.title,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน incident_report_pending ไม่สำเร็จ (incident ${incident.id}): ${(err as Error).message}`,
      );
    }
  }

  /** แจ้ง ST/OT ผู้รายงานว่า Operation ตัดสินใจแล้ว — never-throw (mirror
   * `notifyRequesterOfDecision()` ของ Device Config Override) */
  private async notifyReporterOfDecision(
    incident: Incident,
    outcome: DecideIncidentDto['outcome'],
  ): Promise<void> {
    if (!incident.reportedBy) return;
    try {
      const type =
        outcome === 'resolve'
          ? 'incident_report_resolved'
          : outcome === 'dismiss'
            ? 'incident_report_dismissed'
            : 'incident_report_promoted';
      await this.notificationService.send({
        userId: incident.reportedBy,
        type,
        payload: {
          incidentId: incident.id,
          deviceId: incident.deviceId,
          reviewNote: incident.reviewNote,
        },
      });
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน incident_report decision ไม่สำเร็จ (incident ${incident.id}): ${(err as Error).message}`,
      );
    }
  }
}
