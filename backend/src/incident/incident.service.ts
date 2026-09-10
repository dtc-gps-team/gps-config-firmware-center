import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConfigSyncFailure,
  ConfigSyncWriterQueue,
} from '../config-sync-writer/config-sync-writer-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { INCIDENT_SOURCE, IncidentMetadata } from './incident-metadata';

/**
 * incident module (ฝั่ง A) — รอบนี้ทำเฉพาะ **สร้าง Incident อัตโนมัติเมื่อ
 * config-sync-writer เขียนไม่สำเร็จ** (มติที่ประชุม #32 — docs/07 §9.5, §5) ·
 * ยังไม่มี controller / endpoint (incident detail UI = Sprint 3, checklist แถว 28)
 *
 * ฟัง event `'sync-failed'` จาก `ConfigSyncWriterQueue` — B จะมี listener แยก
 * ของตัวเอง (`incident_alert` notification) คนละ PR โดยไม่ต้องแตะไฟล์นี้
 */
@Injectable()
export class IncidentService implements OnModuleInit {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configSyncQueue: ConfigSyncWriterQueue,
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
}
