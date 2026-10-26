import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  Config,
  ConfigApplyRequest,
  ConfigApplyRequestStatus,
  ConfigStatus,
  Device,
  NotificationType,
  Prisma,
} from '@prisma/client';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import { RolloutEvents } from '../campaign/rollout-events';
import { mergeApprovedOverride } from '../device/config-override-merge';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, TaskService } from '../task/task.service';
import {
  CONFIG_APPLY_REQUEST_TTL_HOURS,
  OPEN_CONFIG_APPLY_REQUEST_STATUSES,
} from './config-apply-request-status';
import { CreateConfigApplyRequestDto } from './dto/create-config-apply-request.dto';
import { RejectConfigApplyRequestDto } from './dto/reject-config-apply-request.dto';
import {
  FIELD_APPLY_RESULT_EVENT,
  FIELD_APPLY_ROLLOUT_STARTER,
  type FieldApplyResultEvent,
  type FieldApplyRolloutStarter,
} from './field-apply-rollout';

/** AuditLog.auditModule ของทุกแถวที่โมดูลนี้เขียน (docs/25 §3.7) */
const AUDIT_MODULE = 'config-apply-request';

const OPERATION_ROLE = 'Operation';

// สำเนาของ `APPLICABLE_CONFIG_STATUSES` (device/config-applier.ts) และ
// `TESTABLE_DEVICE_STATUS` (device.service.ts) — เงื่อนไขเดียวกับ
// `DeviceService.applyConfig()` (docs/25 §3.3 แถว "mirror applyConfig") ทำสำเนา
// แบบเดียวกับ `CONFIG_STATUSES_ASSIGNABLE_TO_TASK` ใน task.service.ts
const APPLICABLE_CONFIG_STATUSES: readonly ConfigStatus[] = [
  'approved',
  'synced',
];
const INSTALLED_DEVICE_STATUS = 'installed';

/** Rollout ที่ "ค้างอยู่" — เครื่องที่เป็น target `pending` ของ Rollout พวกนี้
 * ขอส่งซ้อนไม่ได้ (docs/25 §3.3 กันชนกับ Campaign) */
const OPEN_ROLLOUT_STATUSES = ['active', 'paused'] as const;

const LIST_INCLUDE = {
  task: { select: { id: true, title: true } },
  config: {
    select: {
      id: true,
      name: true,
      deviceModel: true,
      protocol: true,
      fields: true,
    },
  },
  requester: { select: { id: true, fullName: true } },
  configAssigner: { select: { id: true, fullName: true } },
  decider: { select: { id: true, fullName: true } },
} satisfies Prisma.ConfigApplyRequestInclude;

type RequestWithRelations = Prisma.ConfigApplyRequestGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

/** แถวของคิวอนุมัติ (`GET /config-apply-requests`) — ข้อมูลที่การ์ด Approval
 * Center ใช้ (§3.4) · `fieldNames` เป็นชื่อ field ที่จะส่ง (รวม Device Config
 * Override ที่ approved) **ไม่มีค่าจริง** (หลักเดียวกับ AuditLog metadata) */
export type ConfigApplyRequestView = Omit<RequestWithRelations, 'config'> & {
  config: Omit<RequestWithRelations['config'], 'fields'>;
  fieldNames: string[];
};

/**
 * คำขอ "ส่ง Config ของ Task เข้าเครื่องจริง" (docs/25, PR #364) — ช่างขอ,
 * Operation **อีกคน** อนุมัติ แล้วระบบสร้าง Rollout เครื่องเดียวส่งผ่านเส้นทาง
 * เดียวกับ Campaign (ทาง ค.)
 *
 * Separation of Duty (§3.4) เช็คที่นี่ทุกครั้ง ไม่พึ่ง UI ซ่อนปุ่ม และ **fail
 * closed**: ข้อมูลที่ต้องใช้เช็คหายไป = ปฏิเสธ ไม่ปล่อยผ่าน
 */
@Injectable()
export class ConfigApplyRequestService implements OnModuleInit {
  private readonly logger = new Logger(ConfigApplyRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly taskService: TaskService,
    @Inject(FIELD_APPLY_ROLLOUT_STARTER)
    private readonly rolloutStarter: FieldApplyRolloutStarter,
    private readonly rolloutEvents: RolloutEvents,
  ) {}

  /** ฟังผลจาก Rollout เครื่องเดียว (§3.5 ข้อ 5) — listener จัดการ error เอง
   * (ข้อกำหนดของ `RolloutEvents`) */
  onModuleInit(): void {
    this.rolloutEvents.on(
      FIELD_APPLY_RESULT_EVENT,
      (event: FieldApplyResultEvent) => {
        void this.recordRolloutOutcome(event);
      },
    );
  }

  /**
   * `POST /tasks/{taskId}/config-apply-requests` (§3.3) — Config และเครื่องมาจาก
   * Task เสมอ ไม่รับจาก client
   */
  async create(
    taskId: string,
    dto: CreateConfigApplyRequestDto,
    actor: ActingUser,
  ): Promise<ConfigApplyRequest> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    // IDOR: ไม่ใช่ผู้ถูก assign = 404 ไม่เปิดเผยว่ามีงานนี้ (เหมือน GET /tasks/{id})
    if (!task || task.assignedTo !== actor.id) {
      throw new NotFoundException(`ไม่พบงาน id ${taskId}`);
    }
    if (task.status !== 'in_progress') {
      throw new ConflictException(
        `งานต้องอยู่สถานะกำลังทำ (in_progress) ถึงจะขอส่ง Config ได้ — สถานะปัจจุบัน: ${task.status}`,
      );
    }
    if (!task.configId || !task.deviceId) {
      throw new ConflictException(
        'งานนี้ไม่มี Config หรือเครื่องที่ผูกไว้ ขอส่ง Config ไม่ได้',
      );
    }
    // fail closed (§4.2): งานเก่าก่อนมี configAssignedBy ไม่รู้ว่าใครผูก Config
    // จึงเช็ค SoD ข้อ 3 ไม่ได้
    if (!task.configAssignedBy) {
      throw new ConflictException(
        'งานนี้ยังไม่มีข้อมูลผู้ผูก Config ให้ Operation ผูก Config ใหม่ก่อน',
      );
    }
    const configId = task.configId;
    const deviceId = task.deviceId;
    const configAssignedBy = task.configAssignedBy;
    await this.assertApplicable(this.prisma, configId, deviceId, 'create');

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockDevice(tx, deviceId);
      const open = await tx.configApplyRequest.findFirst({
        where: { deviceId, status: { in: OPEN_CONFIG_APPLY_REQUEST_STATUSES } },
      });
      if (open) {
        throw new ConflictException(
          'เครื่องนี้มีคำขอส่ง Config ที่ยังไม่จบอยู่แล้ว — รอผลหรือยกเลิกคำขอเดิมก่อน',
        );
      }
      await this.assertNoOpenRolloutTarget(tx, deviceId);

      const now = new Date();
      const request = await tx.configApplyRequest.create({
        data: {
          taskId,
          deviceId,
          configId,
          configAssignedBy,
          requestedBy: actor.id,
          requestedAt: now,
          expiresAt: new Date(
            now.getTime() + CONFIG_APPLY_REQUEST_TTL_HOURS * 60 * 60 * 1000,
          ),
          note: dto.note?.trim() || null,
        },
      });
      await this.writeAudit(tx, 'config_apply_request', actor, request);
      return request;
    });

    await this.notifyOperations(created);
    return created;
  }

  /** `GET /tasks/{taskId}/config-apply-requests` — ใครเห็น Task ได้ก็เห็นคำขอของ
   * Task นั้น (กฎเดียวกับ `GET /tasks/{id}`, §3.3) ใหม่สุดขึ้นก่อน */
  async listForTask(
    taskId: string,
    actor: ActingUser,
  ): Promise<ConfigApplyRequest[]> {
    await this.taskService.findOne(taskId, actor);
    return this.prisma.configApplyRequest.findMany({
      where: { taskId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /** `GET /config-apply-requests?status=` — คิวของ Approval Center (§3.4) */
  async list(
    status?: ConfigApplyRequestStatus,
  ): Promise<ConfigApplyRequestView[]> {
    const rows = await this.prisma.configApplyRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { requestedAt: 'desc' },
      include: LIST_INCLUDE,
    });
    const views: ConfigApplyRequestView[] = [];
    for (const row of rows) {
      const { fields } = await mergeApprovedOverride(
        this.prisma,
        row.deviceId,
        row.configId,
        row.config.fields,
      );
      const { fields: _baseFields, ...config } = row.config;
      void _baseFields;
      views.push({ ...row, config, fieldNames: Object.keys(fields) });
    }
    return views;
  }

  /**
   * `POST /config-apply-requests/{id}/approve` (§3.4–§3.5) — SoD ครบทุกข้อ →
   * ตรวจซ้ำแบบสดในทรานแซกชัน → `sending` + สร้าง Rollout เครื่องเดียว (ผ่าน
   * `FieldApplyRolloutStarter` ของ campaign) → เริ่มส่งหลัง commit
   *
   * ถ้าฝั่ง campaign สร้าง Rollout ไม่ได้ (รวมตอนที่ยังเป็นตัวแทนชั่วคราว) ทั้ง
   * ทรานแซกชัน rollback คำขอยัง `pending`
   */
  async approve(id: string, actor: ActingUser): Promise<ConfigApplyRequest> {
    const existing = await this.getPendingOrThrow(id);
    await this.assertDecider(existing, actor);

    const approved = await this.prisma.$transaction(async (tx) => {
      await this.assertStillApplicable(tx, existing);
      const result = await tx.configApplyRequest.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'sending', decidedBy: actor.id, decidedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินใจไปแล้ว (มีการอนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const { rolloutId } = await this.rolloutStarter.createFieldApplyRollout(
        tx,
        {
          requestId: existing.id,
          deviceId: existing.deviceId,
          configId: existing.configId,
          requestedBy: existing.requestedBy,
          approvedBy: actor.id,
        },
      );
      const row = await tx.configApplyRequest.update({
        where: { id },
        data: { rolloutId },
      });
      await this.writeAudit(tx, 'config_apply_approve', actor, row);
      return row;
    });

    // ส่งจริงหลัง commit (§3.5 ข้อ 3) — ส่งไม่ได้ให้ฝั่ง campaign บันทึกเป็นผล
    // ล้มเหลวของ target แล้วส่งกลับมาทาง FIELD_APPLY_RESULT_EVENT ไม่ throw ที่นี่
    // เพราะการอนุมัติ commit ไปแล้ว
    try {
      await this.rolloutStarter.startFieldApplyRollout(
        approved.rolloutId as string,
        actor.id,
      );
    } catch (err) {
      this.logger.error(
        `เริ่มส่ง Rollout ของคำขอ ${approved.id} ไม่สำเร็จ (rollout ${approved.rolloutId}): ${(err as Error).message}`,
      );
    }
    return approved;
  }

  /** `POST /config-apply-requests/{id}/reject` — SoD ชุดเดียวกับ approve (§3.4
   * "ตอนอนุมัติหรือปฏิเสธ") ไม่ตรวจซ้ำแบบสดเพราะการปฏิเสธไม่ส่งอะไรเข้าเครื่อง */
  async reject(
    id: string,
    dto: RejectConfigApplyRequestDto,
    actor: ActingUser,
  ): Promise<ConfigApplyRequest> {
    const existing = await this.getPendingOrThrow(id);
    await this.assertDecider(existing, actor);

    const rejected = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.configApplyRequest.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'rejected',
          decidedBy: actor.id,
          decidedAt: now,
          rejectReason: dto.rejectReason.trim(),
          completedAt: now,
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินใจไปแล้ว (มีการอนุมัติ/ปฏิเสธอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const row = await tx.configApplyRequest.findUniqueOrThrow({
        where: { id },
      });
      await this.writeAudit(tx, 'config_apply_reject', actor, row);
      return row;
    });

    await this.notifyRequester(rejected, 'config_apply_rejected', {
      rejectReason: rejected.rejectReason,
    });
    return rejected;
  }

  /** `POST /config-apply-requests/{id}/cancel` — ผู้ขอเท่านั้น เฉพาะตอน
   * `pending` (§3.3) · ไม่ใช่ผู้ขอ = 404 (IDOR) */
  async cancel(id: string, actor: ActingUser): Promise<ConfigApplyRequest> {
    const existing = await this.prisma.configApplyRequest.findUnique({
      where: { id },
    });
    if (!existing || existing.requestedBy !== actor.id) {
      throw new NotFoundException(`ไม่พบคำขอ id ${id}`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `ยกเลิกได้เฉพาะคำขอที่รออนุมัติ — สถานะปัจจุบัน: ${existing.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.configApplyRequest.updateMany({
        where: { id, requestedBy: actor.id, status: 'pending' },
        data: {
          status: 'cancelled',
          resultDetail: 'ผู้ขอยกเลิกคำขอเอง',
          completedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินใจไปแล้วระหว่างที่ยกเลิก — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const row = await tx.configApplyRequest.findUniqueOrThrow({
        where: { id },
      });
      await this.writeAudit(tx, 'config_apply_cancel', actor, row);
      return row;
    });
  }

  /**
   * ปิดคำขอ `pending` ที่เลย `expiresAt` (§3.9, มติ Q9) เป็น `expired` แล้วแจ้ง
   * ผู้ขอ — เรียกจาก `ConfigApplyRequestExpiryJob` · claim ทีละแถวด้วย
   * `updateMany` เงื่อนไข `pending` กันชนกับ Operation ที่กดตัดสินพร้อมกัน ·
   * คืนจำนวนที่ปิดได้
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.configApplyRequest.findMany({
      where: { status: 'pending', expiresAt: { lte: now } },
    });
    let expired = 0;
    for (const request of overdue) {
      const result = await this.prisma.configApplyRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: {
          status: 'expired',
          resultDetail: `ไม่มี Operation ตัดสินภายใน ${CONFIG_APPLY_REQUEST_TTL_HOURS} ชั่วโมง คำขอหมดอายุ`,
          completedAt: now,
        },
      });
      if (result.count === 0) continue;
      expired += 1;
      await this.notifyRequester(request, 'config_apply_expired');
    }
    return expired;
  }

  /**
   * รับผลจาก Rollout เครื่องเดียว (§3.5 ข้อ 5) — `sending` → ผลจากกล่อง แล้ว
   * แจ้งผู้ขอ · `skipped_offline` แจ้งเป็น `config_apply_failed` แยกเหตุผลใน
   * payload (§3.6) · **never-throw** (เรียกจาก event listener) · คืน `true`
   * เมื่ออัปเดตคำขอได้จริง
   */
  async recordRolloutOutcome(event: FieldApplyResultEvent): Promise<boolean> {
    try {
      const result = await this.prisma.configApplyRequest.updateMany({
        where: { rolloutId: event.rolloutId, status: 'sending' },
        data: {
          status: event.outcome,
          resultDetail: event.detail,
          completedAt: new Date(),
        },
      });
      if (result.count === 0) {
        return false;
      }
      const request = await this.prisma.configApplyRequest.findUniqueOrThrow({
        where: { rolloutId: event.rolloutId },
      });
      await this.notifyRequester(
        request,
        event.outcome === 'succeeded'
          ? 'config_apply_succeeded'
          : 'config_apply_failed',
        event.outcome === 'succeeded'
          ? {}
          : { outcome: event.outcome, detail: event.detail },
      );
      return true;
    } catch (err) {
      this.logger.error(
        `บันทึกผลของ Rollout ${event.rolloutId} เข้าคำขอไม่สำเร็จ: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // -------------------------------------------------------------------------

  private async getPendingOrThrow(id: string): Promise<ConfigApplyRequest> {
    const existing = await this.prisma.configApplyRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`ไม่พบคำขอ id ${id}`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `คำขอนี้ถูกตัดสินใจไปแล้ว (สถานะปัจจุบัน: ${existing.status})`,
      );
    }
    return existing;
  }

  /**
   * Separation of Duty ของผู้ตัดสิน (§3.4 ข้อ 1–5) — ทุกข้อ 403:
   * 1. ต้องเป็น role Operation
   * 2. ≠ ผู้ขอ
   * 3. ≠ ผู้ผูก Config เข้า Task (`configAssignedBy` ที่ snapshot ไว้)
   * 4. `configAssignedBy` ว่าง = ปฏิเสธ (fail closed)
   * 5. ≠ ผู้อนุมัติตัว Config (`Config.approvedBy`, มติ Q8) และถ้า
   *    `Config.approvedBy` ว่างก็ปฏิเสธ (fail closed — §3.4 ข้อ 5 ยังไม่ได้ตกลง
   *    กรณีนี้ จึงเลือกทางที่ไม่ผ่อน รอยืนยันกับ A)
   */
  private async assertDecider(
    request: ConfigApplyRequest,
    actor: ActingUser,
  ): Promise<void> {
    if (actor.role !== OPERATION_ROLE) {
      throw new ForbiddenException(
        'ตัดสินคำขอส่ง Config ได้เฉพาะ Role Operation เท่านั้น',
      );
    }
    if (request.requestedBy === actor.id) {
      throw new ForbiddenException(
        'ผู้ขอส่ง Config ตัดสินคำขอของตัวเองไม่ได้ (Separation of Duty)',
      );
    }
    if (!request.configAssignedBy) {
      throw new ForbiddenException(
        'คำขอนี้ไม่มีข้อมูลผู้ผูก Config เข้างาน ตรวจ Separation of Duty ไม่ได้ จึงตัดสินไม่ได้',
      );
    }
    if (request.configAssignedBy === actor.id) {
      throw new ForbiddenException(
        'ผู้ผูก Config เข้างานนี้อนุมัติการส่งเองไม่ได้ (Separation of Duty)',
      );
    }
    const config = await this.prisma.config.findUnique({
      where: { id: request.configId },
      select: { approvedBy: true },
    });
    if (!config?.approvedBy) {
      throw new ForbiddenException(
        'Config นี้ไม่มีข้อมูลผู้อนุมัติ ตรวจ Separation of Duty ไม่ได้ จึงตัดสินไม่ได้',
      );
    }
    if (config.approvedBy === actor.id) {
      throw new ForbiddenException(
        'ผู้อนุมัติตัว Config นี้อนุมัติการส่งเข้าเครื่องเองไม่ได้ (Separation of Duty)',
      );
    }
  }

  /**
   * Config ส่งเข้าเครื่องนี้ได้ไหม — mirror `DeviceService.applyConfig()`:
   * Config ไม่พบ/ถูกลบ 404 · สถานะไม่ใช่ approved/synced 409 · เครื่องไม่พบ
   * 404 (ตอนตรวจซ้ำตอนอนุมัติเป็น 409 เพราะคำขอมีอยู่แล้ว) · ยังไม่ installed
   * หรือรุ่น/protocol ไม่ตรง 409
   */
  private async assertApplicable(
    db: Prisma.TransactionClient,
    configId: string,
    deviceId: string,
    phase: 'create' | 'approve',
  ): Promise<{ config: Config; device: Device }> {
    const config = await db.config.findUnique({ where: { id: configId } });
    if (!config || config.deletedAt !== null) {
      if (phase === 'approve') {
        throw new ConflictException('Config ของคำขอนี้ถูกลบไปแล้ว');
      }
      throw new NotFoundException(`ไม่พบ Config id ${configId}`);
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังส่งเข้าเครื่องไม่ได้ — ต้องเป็น ${APPLICABLE_CONFIG_STATUSES.join('/')}`,
      );
    }
    const device = await db.device.findUnique({ where: { deviceId } });
    if (!device) {
      if (phase === 'approve') {
        throw new ConflictException(`ไม่พบเครื่อง ${deviceId} แล้ว`);
      }
      throw new NotFoundException(`ไม่พบเครื่อง ${deviceId}`);
    }
    if (device.status !== INSTALLED_DEVICE_STATUS) {
      throw new ConflictException(
        `เครื่องสถานะปัจจุบัน (${device.status}) ยังส่ง Config ไม่ได้ — ต้องเป็น ${INSTALLED_DEVICE_STATUS} (ติดตั้งจริงแล้ว)`,
      );
    }
    if (
      config.deviceModel !== device.deviceModel ||
      config.protocol !== device.protocol
    ) {
      throw new ConflictException(
        `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับเครื่อง ${device.deviceModel}/${device.protocol}`,
      );
    }
    return { config, device };
  }

  /**
   * ตรวจซ้ำแบบสดตอนอนุมัติ ในทรานแซกชันเดียวกับการเปลี่ยนสถานะ (§3.5 ข้อ 1)
   * — ล็อกแถว Task ก่อน แล้วเช็คว่างานยังเหมือนตอนขอ · ไม่ผ่าน = 409 และคำขอยัง
   * `pending` ให้ Operation ปฏิเสธพร้อมเหตุผล
   *
   * เพิ่มจากแผน: `Task.configAssignedBy` ต้องยังเป็นคนเดียวกับที่ snapshot ไว้
   * — ถ้า Operation คนอื่นผูก Config ใหม่ระหว่างรอ SoD ข้อ 3 ที่เช็คกับ snapshot
   * จะไม่ครอบคนผูกล่าสุด ให้ช่างขอใหม่แทน (เข้มขึ้น ไม่ผ่อน)
   */
  private async assertStillApplicable(
    tx: Prisma.TransactionClient,
    request: ConfigApplyRequest,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${request.taskId} FOR UPDATE`;
    const task = await tx.task.findUnique({ where: { id: request.taskId } });
    if (!task || task.status !== 'in_progress') {
      throw new ConflictException(
        'งานของคำขอนี้ไม่ได้อยู่สถานะกำลังทำแล้ว — ปฏิเสธคำขอพร้อมเหตุผลแทน',
      );
    }
    if (task.assignedTo !== request.requestedBy) {
      throw new ConflictException(
        'งานถูกย้ายไปให้คนอื่นแล้วตั้งแต่ส่งคำขอ — ปฏิเสธคำขอพร้อมเหตุผลแทน',
      );
    }
    if (
      task.configId !== request.configId ||
      task.deviceId !== request.deviceId ||
      task.configAssignedBy !== request.configAssignedBy
    ) {
      throw new ConflictException(
        'Config หรือเครื่องของงานถูกเปลี่ยนแล้วตั้งแต่ส่งคำขอ — ปฏิเสธคำขอแล้วให้ช่างขอใหม่',
      );
    }
    await this.assertApplicable(
      tx,
      request.configId,
      request.deviceId,
      'approve',
    );
    await this.assertNoOpenRolloutTarget(tx, request.deviceId);
  }

  private async assertNoOpenRolloutTarget(
    tx: Prisma.TransactionClient,
    deviceId: string,
  ): Promise<void> {
    const target = await tx.campaignRolloutTarget.findFirst({
      where: {
        deviceId,
        status: 'pending',
        rollout: { status: { in: [...OPEN_ROLLOUT_STATUSES] } },
      },
      select: { id: true },
    });
    if (target) {
      throw new ConflictException(
        'มี Campaign กำลังส่ง Config ให้เครื่องนี้อยู่ — รอ Campaign จบก่อน',
      );
    }
  }

  /** ล็อกระดับเครื่อง (advisory lock ถึงจบทรานแซกชัน) — กันสองงานที่ผูกเครื่อง
   * เดียวกันสร้างคำขอซ้อนกัน (§4.1: Prisma ไม่มี partial unique index) ·
   * แข็งกว่าการล็อกแถว Task ที่แผนเสนอ เพราะคำขอซ้อนข้าม Task ได้ */
  private async lockDevice(
    tx: Prisma.TransactionClient,
    deviceId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`config-apply-request:${deviceId}`}))::text`;
  }

  /** AuditLog ในทรานแซกชันเดียวกับการเปลี่ยนข้อมูล (mirror Device Config
   * Override) · metadata มีแค่เครื่องกับ Config ไม่มีค่า field (§3.7) */
  private async writeAudit(
    tx: Prisma.TransactionClient,
    action: string,
    actor: ActingUser,
    request: ConfigApplyRequest,
  ): Promise<void> {
    const metadata: AuditLogMetadata = {
      deviceId: request.deviceId,
      configId: request.configId,
    };
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: AUDIT_MODULE,
        action,
        metadata: metadata as Prisma.InputJsonValue,
        ipAddress: actor.ipAddress ?? null,
      },
    });
  }

  /** แจ้ง Operation ทุกคน **ยกเว้น**ผู้ผูก Config เข้างาน (อนุมัติไม่ได้อยู่แล้ว)
   * และผู้ขอ (§3.6) · never-throw — คำขอถูกสร้างแล้วจริง */
  private async notifyOperations(request: ConfigApplyRequest): Promise<void> {
    try {
      const operations = await this.prisma.user.findMany({
        where: {
          role: { code: OPERATION_ROLE },
          isActive: true,
          id: { notIn: [request.configAssignedBy, request.requestedBy] },
        },
        select: { id: true },
      });
      for (const operation of operations) {
        await this.notificationService.send({
          userId: operation.id,
          type: 'config_apply_pending',
          payload: this.notificationPayload(request),
        });
      }
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน config_apply_pending ไม่สำเร็จ (คำขอ ${request.id}): ${(err as Error).message}`,
      );
    }
  }

  /** แจ้งผู้ขอ · never-throw */
  private async notifyRequester(
    request: ConfigApplyRequest,
    type: NotificationType,
    extra: Record<string, string | null> = {},
  ): Promise<void> {
    try {
      await this.notificationService.send({
        userId: request.requestedBy,
        type,
        payload: { ...this.notificationPayload(request), ...extra },
      });
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน ${type} ไม่สำเร็จ (คำขอ ${request.id}): ${(err as Error).message}`,
      );
    }
  }

  /** payload ตาม §3.6 — `taskId` ให้ Mobile เปิด Task Detail จาก notification */
  private notificationPayload(
    request: ConfigApplyRequest,
  ): Record<string, string> {
    return {
      requestId: request.id,
      taskId: request.taskId,
      deviceId: request.deviceId,
    };
  }
}
