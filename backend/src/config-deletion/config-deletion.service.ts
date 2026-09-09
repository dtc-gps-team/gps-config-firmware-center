import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Config, ConfigDeletionRequest, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryConfigDeletionDto } from './dto/query-config-deletion.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** เกณฑ์ §2.5 — Config ต้องไม่ถูกแก้ไขนานกว่านี้ถึงจะเข้าข่ายเสนอลบ */
export const INACTIVITY_DAYS = 90;

/** เกณฑ์ §2.7 — หลัง SuperAdmin reject คำขอลบ Config ตัวนั้นพักไม่ถูกเสนอลบซ้ำ
 * เท่านี้วัน (นับจาก `reviewedAt` ของคำขอที่ถูก reject) */
export const REJECT_COOLDOWN_DAYS = 90;

/** §3 — ผู้สร้าง Config มีเวลากด "เก็บไว้" ก่อน SuperAdmin ตัดสิน · ใช้ในข้อความ
 * แจ้งเตือนเท่านั้น ไม่ได้บังคับให้ SuperAdmin รอครบ 7 วัน (ดู §10 ข้อ 2:
 * "state เดียว" — คำขอโผล่ในคิว SuperAdmin ทันทีที่สร้าง) */
export const GRACE_PERIOD_DAYS = 7;

const SUPER_ADMIN_ROLE_CODE = 'SuperAdmin';
const AUDIT_MODULE = 'config-deletion';

@Injectable()
export class ConfigDeletionService {
  private readonly logger = new Logger(ConfigDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Scheduled job (รายวัน — ดู config-deletion.job.ts) — กวาดหา Config ที่เข้า
   * เกณฑ์ §2 ครบทุกข้อ แล้วสร้าง `ConfigDeletionRequest { status: pending }` +
   * ยิง notification 2 ทาง (§3)
   *
   * **ไม่เขียน `AuditLog`** — job รันโดยระบบ ไม่มี real user actor
   * (`AuditLog.userId` เป็น non-null และไม่มี convention "system actor" ในโค้ด
   * เดิมให้ mirror) · การกระทำที่ลง audit คือตอน SuperAdmin/SW กด approve /
   * reject / keep เท่านั้น
   *
   * คืน list ของคำขอที่สร้างใหม่ (ให้ job log จำนวน + ให้เทสตรวจได้)
   */
  async sweep(): Promise<ConfigDeletionRequest[]> {
    const now = Date.now();
    const inactiveBefore = new Date(now - INACTIVITY_DAYS * DAY_MS);
    const cooldownSince = new Date(now - REJECT_COOLDOWN_DAYS * DAY_MS);

    // เกณฑ์ §2 ทั้ง 7 ข้อใน 1 where clause:
    //   1  status ∈ {draft, rejected}
    //   -  deletedAt: null (ไม่กวาด Config ที่ soft-deleted ไปแล้ว)
    //   2  ไม่มี Task ผูก        5  updatedAt เก่ากว่า 90 วัน
    //   3  ไม่มี Campaign ผูก
    //   4  ไม่มี Incident ผูก
    //   6  ไม่มีคำขอ pending ค้าง
    //   7  ไม่มีคำขอ rejected ที่ reviewedAt ยังไม่พ้น cooldown 90 วัน
    const candidates = await this.prisma.config.findMany({
      where: {
        status: { in: ['draft', 'rejected'] },
        deletedAt: null,
        updatedAt: { lt: inactiveBefore },
        tasks: { none: {} },
        campaigns: { none: {} },
        incidents: { none: {} },
        deletionRequests: {
          none: {
            OR: [
              { status: 'pending' },
              { status: 'rejected', reviewedAt: { gte: cooldownSince } },
            ],
          },
        },
      },
    });

    const created: ConfigDeletionRequest[] = [];
    for (const config of candidates) {
      const request = await this.prisma.configDeletionRequest.create({
        data: {
          configId: config.id,
          reason: `Config สถานะ "${config.status}" ไม่ถูกแก้ไขมานานกว่า ${INACTIVITY_DAYS} วัน และไม่มี Task/Campaign/Incident เชื่อมโยง`,
        },
      });
      created.push(request);
      await this.notifySuperAdmins(config, request);
      await this.notifyCreator(config, request);
    }

    if (created.length > 0) {
      this.logger.log(`สร้างคำขอลบ Config อัตโนมัติ ${created.length} รายการ`);
    }
    return created;
  }

  /** คิวคำขอสำหรับ SuperAdmin — ไม่ระบุ status = `pending` (§5) */
  findRequests(
    query: QueryConfigDeletionDto,
  ): Promise<ConfigDeletionRequest[]> {
    return this.prisma.configDeletionRequest.findMany({
      where: { status: query.status ?? 'pending' },
      include: { config: true },
      orderBy: { detectedAt: 'asc' },
    });
  }

  /**
   * SuperAdmin อนุมัติคำขอลบ → soft delete Config (`deletedAt = now()`) +
   * `request.status = approved` + AuditLog · 409 ถ้าคำขอถูกตัดสินไปแล้ว
   */
  async approve(id: string, actor: ActingUser): Promise<ConfigDeletionRequest> {
    const request = await this.getPendingRequest(id);

    return this.runDecisionTx(async (tx) => {
      const updated = await tx.configDeletionRequest.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedBy: actor.id,
          reviewedAt: new Date(),
        },
      });
      await tx.config.update({
        where: { id: request.configId },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'approve',
        },
      });
      return updated;
    });
  }

  /**
   * SuperAdmin ปฏิเสธคำขอลบ → Config อยู่ต่อ (ไม่แตะ `deletedAt`) ·
   * `request.status = rejected` + `decisionNote` + AuditLog · Config เข้า
   * cooldown 90 วันตามเกณฑ์ §2.7 · 409 ถ้าคำขอถูกตัดสินไปแล้ว
   */
  async reject(
    id: string,
    note: string,
    actor: ActingUser,
  ): Promise<ConfigDeletionRequest> {
    await this.getPendingRequest(id);

    return this.runDecisionTx(async (tx) => {
      const updated = await tx.configDeletionRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          decisionNote: note,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'reject',
        },
      });
      return updated;
    });
  }

  /**
   * ผู้สร้าง Config / SW กด "เก็บไว้" ระหว่าง grace period → คำขอ pending ของ
   * Config นั้นกลายเป็น `cancelled` + reset นาฬิกา 90 วัน (§3 — "แตะ
   * Config.updatedAt") + AuditLog · 404 ถ้าไม่มีคำขอ pending
   *
   * ไม่เซ็ต `reviewedBy`/`reviewedAt` — 2 field นั้นหมายถึง "SuperAdmin ที่
   * ตัดสิน" (relation `ConfigDeletionReviewedBy`) ส่วนใครกด keep ดูจาก
   * AuditLog (`action: keep`, `userId`)
   */
  async keep(
    configId: string,
    actor: ActingUser,
  ): Promise<ConfigDeletionRequest> {
    const request = await this.prisma.configDeletionRequest.findFirst({
      where: { configId, status: 'pending' },
    });
    if (!request) {
      throw new NotFoundException(
        `ไม่มีคำขอลบที่รอดำเนินการสำหรับ Config id ${configId}`,
      );
    }

    return this.runDecisionTx(async (tx) => {
      const updated = await tx.configDeletionRequest.update({
        where: { id: request.id },
        data: { status: 'cancelled' },
      });
      // reset นาฬิกา 90 วัน — Prisma 6 อนุญาตให้ส่งค่า `@updatedAt` ตรงๆ ได้
      await tx.config.update({
        where: { id: configId },
        data: { updatedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'keep',
        },
      });
      return updated;
    });
  }

  /** findUnique + เช็คว่ายัง `pending` — 404 ถ้าไม่พบ, 409 ถ้าถูกตัดสินไปแล้ว */
  private async getPendingRequest(id: string): Promise<ConfigDeletionRequest> {
    const request = await this.prisma.configDeletionRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException(`ไม่พบคำขอลบ Config id ${id}`);
    }
    if (request.status !== 'pending') {
      throw new ConflictException(
        `คำขอลบนี้ถูกตัดสินไปแล้ว (สถานะ ${request.status}) จึงดำเนินการซ้ำไม่ได้`,
      );
    }
    return request;
  }

  /** ครอบ `$transaction` + แปลง P2025 (row ถูกลบระหว่าง check กับ write, rare)
   * เป็น 404 — pattern เดียวกับ config.service.ts */
  private async runDecisionTx(
    work: (tx: Prisma.TransactionClient) => Promise<ConfigDeletionRequest>,
  ): Promise<ConfigDeletionRequest> {
    try {
      return await this.prisma.$transaction(work);
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(
          'ไม่พบคำขอลบ Config หรือ Config ที่เกี่ยวข้อง',
        );
      }
      throw err;
    }
  }

  /** แจ้ง SuperAdmin ทุกคนที่ active ว่ามีคำขอลบรออนุมัติ · **Never throws** —
   * pattern เดียวกับ task.service.ts notifyTaskAssigned() */
  private async notifySuperAdmins(
    config: Config,
    request: ConfigDeletionRequest,
  ): Promise<void> {
    try {
      const superAdmins = await this.prisma.user.findMany({
        where: { role: { code: SUPER_ADMIN_ROLE_CODE }, isActive: true },
        select: { id: true },
      });
      for (const admin of superAdmins) {
        await this.notificationService.send({
          userId: admin.id,
          type: 'config_deletion_pending',
          payload: {
            requestId: request.id,
            configId: config.id,
            configName: config.name,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน config_deletion_pending ไม่สำเร็จ (request ${request.id}): ${
          (err as Error).message
        }`,
      );
    }
  }

  /** แจ้งผู้สร้าง Config ว่าถูกเสนอลบ ให้กด "เก็บไว้" ภายใน grace period ·
   * **Never throws** */
  private async notifyCreator(
    config: Config,
    request: ConfigDeletionRequest,
  ): Promise<void> {
    try {
      await this.notificationService.send({
        userId: config.createdBy,
        type: 'config_deletion_grace',
        payload: {
          requestId: request.id,
          configId: config.id,
          configName: config.name,
          gracePeriodDays: GRACE_PERIOD_DAYS,
        },
      });
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน config_deletion_grace ไม่สำเร็จ (request ${request.id}, user ${config.createdBy}): ${
          (err as Error).message
        }`,
      );
    }
  }
}
