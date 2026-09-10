import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Incident, Prisma } from '@prisma/client';
import {
  ConfigSyncFailure,
  ConfigSyncWriterQueue,
} from '../config-sync-writer/config-sync-writer-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryIncidentDto } from './dto/query-incident.dto';
import { INCIDENT_SOURCE, IncidentMetadata } from './incident-metadata';

/**
 * incident module (ฝั่ง A) — 2 หน้าที่:
 *   1. สร้าง Incident อัตโนมัติเมื่อ config-sync-writer เขียนไม่สำเร็จ
 *      (`createFromSyncFailure`, listener — มติที่ประชุม #32, docs/07 §9.5/§5)
 *   2. read-only endpoint `GET /incidents` + `GET /incidents/:id`
 *      (`findAllIncidents` / `findIncidentById` — Sprint 2, ดู incident.controller.ts)
 *
 * ยังไม่มี Create/Update/Rollback ผ่าน API — Create เป็น auto อย่างเดียว
 *
 * ฟัง event `'sync-failed'` จาก `ConfigSyncWriterQueue` — B มี listener แยก
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

  /**
   * รายการ Incident ทั้งหมด (read-only) — resource `incidents` action `Read`
   * grant ให้ทุก role (RBAC_Matrix.md แถว "Incident & Rollback" = R ทุก role) ·
   * เรียงตาม `createdAt desc` (ใหม่สุดก่อน) · ไม่มี paging ตาม MVP เดียวกับ
   * `devices` (จำนวนข้อมูลน้อย)
   */
  findAllIncidents(query: QueryIncidentDto): Promise<Incident[]> {
    const { status, relatedConfigId, relatedFirmwareId } = query;
    return this.prisma.incident.findMany({
      where: {
        status: status || undefined,
        relatedConfigId: relatedConfigId || undefined,
        relatedFirmwareId: relatedFirmwareId || undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Incident 1 รายการตาม id — 404 ถ้าไม่พบ (mirror `device.service` findByDeviceId) */
  async findIncidentById(id: string): Promise<Incident> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new NotFoundException(`ไม่พบ Incident id ${id}`);
    }
    return incident;
  }
}
