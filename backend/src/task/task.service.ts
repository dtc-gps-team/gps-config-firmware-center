import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigStatus, Prisma, Task, TaskStatus } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskNoteDto } from './dto/create-task-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { StartTaskDto } from './dto/start-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
  /** มาจาก `req.ip` ที่ controller แนบมาด้วย (docs §13.3 Audit Log ระบุ IP
   * Address เป็น field ที่ต้องเก็บ) — optional mirror `config.service.ts` */
  ipAddress?: string | null;
}

/**
 * 1 รายการบน timeline ของ Task (`GET /tasks/{id}/events`, issue #296) —
 * mirror `TaskEvent` ใน openapi.yaml · `changedByName` คือ `User.fullName`
 * ของผู้ทำรายการ (join มาให้เลย เพราะ ST/OT บน Mobile ไม่มีสิทธิ์อ่านรายชื่อ
 * ผู้ใช้เอง) — `null` เมื่อไม่รู้ผู้ทำ (event "สร้างงาน" ที่ backfill ให้งานเก่า)
 */
export interface TaskEventView {
  id: string;
  taskId: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: Date;
  note: string | null;
}

const TASK_EVENT_INCLUDE = {
  changer: { select: { fullName: true } },
} satisfies Prisma.TaskEventInclude;

type TaskEventWithChanger = Prisma.TaskEventGetPayload<{
  include: typeof TASK_EVENT_INCLUDE;
}>;

function toEventView(event: TaskEventWithChanger): TaskEventView {
  return {
    id: event.id,
    taskId: event.taskId,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    changedBy: event.changedBy,
    changedByName: event.changer?.fullName ?? null,
    changedAt: event.changedAt,
    note: event.note,
  };
}

/** AuditLog.auditModule ของทุกแถวที่โมดูลนี้เขียน (Sprint 3 #27 follow-up —
 * PR #145 เปิดโมดูล `audit`/`GET /audit-logs` แล้วแต่ task/notification ยังไม่
 * เขียน) — mirror ชื่อ module string ของ `config.service.ts`/`device.service.ts` */
const AUDIT_MODULE = 'task';

const OPERATION_ROLE = 'Operation';

const CANCEL_REASON_TASK_CANCELLED = 'งานถูกยกเลิก ระบบยกเลิกคำขอให้อัตโนมัติ';
const CANCEL_REASON_TASK_COMPLETED =
  'ช่างปิดงานแล้ว ระบบยกเลิกคำขอให้อัตโนมัติ';

/** แถว Task ที่ `lockTask()` อ่านมาตอนล็อก */
interface LockedTask {
  status: TaskStatus;
  createdAt: Date;
  assignedTo: string;
}
// ST/OT = ผู้ใช้ Mobile ที่เห็น/แก้ได้เฉพาะงานที่ตัวเองถูก assign เท่านั้น
// (ดู docs/architecture/RBAC_Matrix.md Section 4.3 และ Section 5 ข้อ 8)
// — export ให้ `DeviceHistoryService` (#371) ใช้กฎเดียวกันตอนกรองรายการ
// ประเภท `task` กันประวัติรวมเปิดเผยงานที่ role นั้นเรียกตรงไม่ได้
export const SELF_SCOPED_ROLES: readonly string[] = ['ST', 'OT'];

// Role ที่ตั้งใจให้เห็นงานของ "ทุกคน" ได้ (RBAC_Matrix.md §4.3/ตาราง Section 2
// แถว Task — grant tasks:Read ของแต่ละ role มี use case ชัดเจนต่างกัน):
// - Operation: สั่งงาน/ควบคุม Campaign ต้องเห็นภาพรวมทุก task
// - Auditor: อ่านทุกอย่างในระบบเพื่อตรวจสอบย้อนหลัง (เหมือนสิทธิ์ AuditLog)
// - Admin/SuperAdmin: ดูแลระบบ ต้อง troubleshoot งานของใครก็ได้
// (issue #73 — เดิม findAll ใช้ "ไม่ใช่ ST/OT = ไม่ scope" ซึ่งเป็น default-allow
// ที่อันตราย: role ใหม่ที่ได้ grant tasks:Read เพิ่มทีหลังโดยไม่ได้ตั้งใจให้เห็น
// ทุกคนจะหลุดเข้ามาเห็นทั้งตารางทันทีโดยไม่มีใครตัดสินใจ — เปลี่ยนเป็น allowlist
// ชัดเจนแทน role ไหนไม่อยู่ในนี้ fallback เป็น self-scoped เสมอ ตาม IDOR
// Prevention Pattern ของ CLAUDE.md (default-deny ไม่ใช่ default-allow)
// — export เหตุผลเดียวกับ `SELF_SCOPED_ROLES` ด้านบน (ใช้โดย #371)
export const UNSCOPED_TASK_ROLES: readonly string[] = [
  'Operation',
  'Auditor',
  'Admin',
  'SuperAdmin',
];

// สถานะที่ ST/OT ตั้งเองผ่าน Mobile ได้ (issue #73 ข้อ 2 — Mobile จำกัด UI ไว้
// แล้วที่ `_fieldStaffStatusChoices` ใน task_detail_page.dart ตัด `cancelled`
// ออกเพราะการยกเลิกงานเป็นสิทธิ์ Operation ไม่ใช่ผู้ถูก assign และตัด `pending`
// ออกเพราะเป็นสถานะเริ่มต้นที่ Operation กำหนดตอนสร้างงาน — backend ต้อง
// enforce ให้ตรงกัน ไม่ใช่พึ่ง UI ฝั่งเดียว (client อื่นที่มี token ST/OT ยิง
// ตรงได้ถ้าไม่เช็คที่นี่)
const ST_OT_ALLOWED_STATUSES: readonly string[] = ['in_progress', 'completed'];

// สถานะสุดท้ายสำหรับ ST/OT — งานที่อยู่ในสถานะเหล่านี้แล้วเปลี่ยนต่อไม่ได้อีก
// (409) · `cancelled` = Operation ยกเลิกงาน, `completed` = งานเสร็จแล้ว ห้าม
// ย้อนกลับ (คำตอบ A ใน #303 ข้อ 1) · Operation ยังแก้ได้ตามเดิม
const ST_OT_FINAL_STATUSES: TaskStatus[] = ['cancelled', 'completed'];

// สถานะ Config ที่ Operation ผูกกับงานติดตั้งได้ — ต้องผ่าน Operation อนุมัติ
// มาแล้วเท่านั้น (`approved` = อนุมัติแล้ว, `synced` = เขียนเข้าระบบเดิมแล้ว)
// ตรงกับ APPLICABLE_CONFIG_STATUSES ใน src/device/config-applier.ts (เงื่อนไข
// ของ POST /devices/{deviceId}/apply-config ที่ Mobile จะเรียกต่อ) — ทำสำเนา
// ไว้ในโมดูล task เพื่อไม่ให้ task (โมดูล B) ผูก import ข้ามไป device (โมดูล A)
const CONFIG_STATUSES_ASSIGNABLE_TO_TASK: readonly ConfigStatus[] = [
  'approved',
  'synced',
];

// งานที่ยัง "เปิด" อยู่ — `POST /tasks/start` ใช้ใบเดิมถ้าช่างมีงานสถานะนี้ของ
// กล่องเดียวกัน (docs/28 D2)
const OPEN_TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress'];

/** ปิดงาน `in_progress` ที่ไม่มีความเคลื่อนไหวเกินเท่านี้ (docs/28 D4, §5.4) */
export const TASK_IDLE_CLOSE_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** ชื่องานที่ช่างเริ่มเอง เช่น "BOX-0001 — 26 ต.ค. 2569" (เวลาไทย) */
export function technicianTaskTitle(deviceId: string, now: Date): string {
  const date = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(now);
  return `${deviceId} — ${date}`;
}

/** ผลของ `POST /tasks/start` — `created=false` คือได้ใบเดิมกลับไป (200) */
export interface StartTaskResult {
  task: Task;
  created: boolean;
}

/** แปลงค่าวันที่จาก DTO (ISO string / null / undefined) ให้เป็นรูปแบบที่ Prisma รับ */
function toDbDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return new Date(value);
}

/**
 * ผู้ผูก Config เข้างาน (docs/25 §4.2) — เขียนทุกครั้งที่ PATCH/POST ส่ง
 * `configId` มา: ตั้งค่า = ผู้เรียก (Operation), ล้าง (`null`) = ล้างผู้ผูกด้วย ·
 * ไม่ส่ง `configId` (`undefined`) = ไม่แตะทั้งสองคอลัมน์ · ส่งค่าเดิมซ้ำนับเป็น
 * "ผูกใหม่" โดยตั้งใจ: เป็นทางเดียวที่ Operation ใช้เติมผู้ผูกให้งานเก่าที่เป็น
 * null (คำขอส่ง Config ของงานพวกนั้นถูกปฏิเสธจนกว่าจะผูกใหม่)
 */
export function configAssignment(
  configId: string | null | undefined,
  actor: ActingUser,
  now: Date = new Date(),
): { configAssignedBy?: string | null; configAssignedAt?: Date | null } {
  if (configId === undefined) {
    return {};
  }
  if (configId === null) {
    return { configAssignedBy: null, configAssignedAt: null };
  }
  return { configAssignedBy: actor.id, configAssignedAt: now };
}

/**
 * `TaskEvent.changedAt` ของการเปลี่ยนสถานะ — ใช้เวลาที่ client ส่งมา (เวลาที่
 * ช่างกดจริงตอนเข้าคิว offline, issue #296) ถ้ามี · เวลาในอนาคต (นาฬิกาเครื่อง
 * เดินเร็ว) ปัดลงเป็นเวลา server แทนการตอบ 400 เพื่อไม่ให้คิว offline ของ
 * Mobile ถูกปฏิเสธถาวรเพราะนาฬิกาเพี้ยน · เวลาก่อน `notBefore` ปัดขึ้นเป็น
 * `notBefore` (ผู้เรียกส่ง `max(Task.createdAt, event เปลี่ยนสถานะล่าสุด)` —
 * ดู `TaskService.statusChangeLowerBound`) กัน timeline เรียงผิด
 */
export function resolveChangedAt(
  requested: string | undefined,
  notBefore: Date,
  now: Date = new Date(),
): Date {
  if (requested === undefined) {
    return now;
  }
  const at = new Date(requested);
  if (at.getTime() > now.getTime()) {
    return now;
  }
  if (at.getTime() < notBefore.getTime()) {
    return notBefore;
  }
  return at;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(dto: CreateTaskDto, actor: ActingUser): Promise<Task> {
    if (actor.role !== OPERATION_ROLE) {
      throw new ForbiddenException('สร้างงานได้เฉพาะ Role Operation เท่านั้น');
    }
    if (dto.configId != null) {
      await this.assertConfigAssignable(dto.configId, dto.deviceId);
    }
    // Task + event "สร้างงาน" (null -> pending) ในทรานแซกชันเดียวกัน
    // (docs/16 §2) — timeline ของทุกงานเริ่มจาก event นี้เสมอ
    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: dto.title,
          description: dto.description,
          assignedTo: dto.assignedTo,
          deviceId: dto.deviceId,
          configId: dto.configId,
          ...configAssignment(dto.configId, actor),
          dueDate: toDbDate(dto.dueDate),
        },
      });
      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          fromStatus: null,
          toStatus: task.status,
          changedBy: actor.id,
          changedAt: task.createdAt,
        },
      });
      return task;
    });
    // งานใหม่ทุกงานมีคนถูก assign เสมอ (assignedTo required ใน CreateTaskDto)
    await this.notifyTaskAssigned(created);
    await this.logAudit('create', actor);
    return created;
  }

  /**
   * `POST /tasks/start` (docs/28 §5.1) — ช่าง (ST/OT, resource `field-task`)
   * เริ่มงานกับกล่องเอง · มีงาน `pending`/`in_progress` ของตัวเองกับกล่องนี้อยู่แล้ว
   * (ไม่ว่า Operation สั่งหรือเริ่มเอง) ใช้ใบเดิม ถ้า `pending` เปลี่ยนเป็น
   * `in_progress` ให้ · ไม่มีก็สร้างใหม่ `source=technician` เป็นของผู้เรียกเสมอ
   *
   * - กล่องไม่พบ 404 · `decommissioned` 409 · ไม่บังคับ `installed` (ไปติดตั้ง
   *   กล่องใหม่ก็เริ่มงานได้ — การขอส่ง Config ยังบังคับ `installed` เหมือนเดิม)
   * - advisory lock ต่อ (ช่าง, กล่อง) กันกดซ้ำพร้อมกันได้ 2 ใบ (Prisma ไม่มี
   *   partial unique index — แบบเดียวกับ `lockDevice()` ของ config-apply-request)
   * - ไม่แจ้ง `task_assigned` (ช่างสร้างให้ตัวเอง)
   */
  async start(dto: StartTaskDto, actor: ActingUser): Promise<StartTaskResult> {
    if (!SELF_SCOPED_ROLES.includes(actor.role)) {
      throw new ForbiddenException('เริ่มงานเองได้เฉพาะช่าง (ST/OT)');
    }
    const deviceId = dto.deviceId.trim();
    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    if (!device) {
      throw new NotFoundException(`ไม่พบเครื่อง ${deviceId}`);
    }
    if (device.status === 'decommissioned') {
      throw new ConflictException(
        `เครื่อง ${deviceId} ปลดระวางแล้ว เริ่มงานไม่ได้`,
      );
    }
    const note = dto.note?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`task-start:${actor.id}:${deviceId}`}))::text`;
      const now = new Date();
      const existing = await tx.task.findFirst({
        where: {
          assignedTo: actor.id,
          deviceId,
          status: { in: OPEN_TASK_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
      });
      let task: Task;
      let created: boolean;
      if (existing) {
        task = existing;
        created = false;
        if (existing.status === 'pending') {
          task = await tx.task.update({
            where: { id: existing.id },
            data: { status: 'in_progress' },
          });
          await tx.taskEvent.create({
            data: {
              taskId: task.id,
              fromStatus: 'pending',
              toStatus: 'in_progress',
              changedBy: actor.id,
              changedAt: now,
            },
          });
        }
      } else {
        task = await tx.task.create({
          data: {
            title: technicianTaskTitle(deviceId, now),
            assignedTo: actor.id,
            deviceId,
            status: 'in_progress',
            source: 'technician',
          },
        });
        created = true;
        await tx.taskEvent.create({
          data: {
            taskId: task.id,
            fromStatus: null,
            toStatus: 'in_progress',
            changedBy: actor.id,
            changedAt: task.createdAt,
          },
        });
      }
      if (note) {
        await tx.taskEvent.create({
          data: { taskId: task.id, changedBy: actor.id, note },
        });
      }
      return { task, created };
    });
    await this.logAudit(result.created ? 'start' : 'resume', actor);
    return result;
  }

  findAll(query: QueryTaskDto, actor: ActingUser): Promise<Task[]> {
    // เฉพาะ role ใน UNSCOPED_TASK_ROLES เท่านั้นที่เลือก assignedTo เองผ่าน query
    // ได้ (หรือปล่อยว่างไว้เพื่อดูทุกคน) — role อื่นทั้งหมด (รวม ST/OT และ role
    // ใหม่ที่อาจได้ grant tasks:Read เพิ่มทีหลังโดยไม่ได้ตั้งใจ) ถูกบังคับ
    // self-scope เสมอ ห้ามใช้ค่า assignedTo จาก client (ดู issue #73 และ
    // RBAC_Matrix.md Section 5 ข้อ 8)
    const assignedTo = UNSCOPED_TASK_ROLES.includes(actor.role)
      ? query.assignedTo
      : actor.id;

    return this.prisma.task.findMany({
      where: { status: query.status, assignedTo },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, actor: ActingUser): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task || this.isHiddenFromActor(task, actor)) {
      // ST/OT ที่ไม่ใช่เจ้าของงาน: 404 แทน 403 เพื่อไม่เปิดเผยว่ามี record นี้อยู่
      // (IDOR Prevention Pattern ใน CLAUDE.md)
      throw new NotFoundException(`ไม่พบงาน id ${id}`);
    }
    return task;
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    actor: ActingUser,
  ): Promise<Task> {
    if (dto.changedAt !== undefined && dto.status === undefined) {
      throw new BadRequestException(
        'changedAt ใช้ได้เฉพาะตอนเปลี่ยน status เท่านั้น',
      );
    }

    if (actor.role === OPERATION_ROLE) {
      const existing = await this.findOne(id, actor);
      if (dto.configId != null) {
        // deviceId ที่จะมีผลหลัง update: ถ้า dto ส่ง deviceId มาด้วยใช้ค่านั้น
        // ไม่งั้นใช้ค่าที่งานมีอยู่เดิม
        const effectiveDeviceId =
          dto.deviceId !== undefined ? dto.deviceId : existing.deviceId;
        await this.assertConfigAssignable(dto.configId, effectiveDeviceId);
      }
      // race condition: ระหว่าง findOne กับ update นี้ row อาจถูกลบไปพอดีจาก
      // request อื่น (rare) — Prisma โยน P2025 ("Record to update not found")
      // ในกรณีนั้น แปลงเป็น 404 แทนที่จะปล่อยเป็น 500 (pattern เดียวกับ
      // ConfigService.update/updateStatus)
      let updated: Task;
      try {
        // Task + TaskEvent ในทรานแซกชันเดียวกัน (docs/16 §2)
        updated = await this.prisma.$transaction(async (tx) => {
          const previous = await this.lockTask(tx, id);
          if (!previous) {
            throw new NotFoundException(`ไม่พบงาน id ${id}`);
          }
          const completing =
            dto.status === 'completed' && previous.status !== 'completed';
          if (completing) {
            await this.assertNoSendingRequest(tx, id);
          }
          const task = await tx.task.update({
            where: { id },
            data: {
              title: dto.title,
              description: dto.description,
              assignedTo: dto.assignedTo,
              deviceId: dto.deviceId,
              configId: dto.configId,
              ...configAssignment(dto.configId, actor),
              status: dto.status,
              dueDate: toDbDate(dto.dueDate),
              ...(completing ? { completedAt: new Date() } : {}),
            },
          });
          await this.recordStatusChange(tx, previous, task, dto, actor);
          if (task.status === 'cancelled' && previous.status !== 'cancelled') {
            await this.cancelPendingConfigApplyRequests(
              tx,
              task.id,
              CANCEL_REASON_TASK_CANCELLED,
            );
          }
          if (completing) {
            await this.cancelPendingConfigApplyRequests(
              tx,
              task.id,
              CANCEL_REASON_TASK_COMPLETED,
            );
          }
          return task;
        });
      } catch (err) {
        if (
          err instanceof PrismaClientKnownRequestError &&
          err.code === 'P2025'
        ) {
          throw new NotFoundException(`ไม่พบงาน id ${id}`);
        }
        throw err;
      }
      // แจ้งเตือนเฉพาะตอน "ย้ายงานไปคนใหม่" จริง — Operation ส่ง assignedTo มา
      // และค่าต่างจากเดิม (แก้แค่ title/dueDate ฯลฯ ไม่ควรมี push)
      if (
        dto.assignedTo !== undefined &&
        dto.assignedTo !== existing.assignedTo
      ) {
        await this.notifyTaskAssigned(updated);
      }
      await this.logAudit('update', actor);
      return updated;
    }

    if (!SELF_SCOPED_ROLES.includes(actor.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขงาน');
    }

    if (this.touchesNonStatusField(dto)) {
      throw new ForbiddenException(
        'ST/OT แก้ได้เฉพาะ field status ของงานที่ตัวเองถูก assign เท่านั้น',
      );
    }

    if (
      dto.status !== undefined &&
      !ST_OT_ALLOWED_STATUSES.includes(dto.status)
    ) {
      throw new ForbiddenException(
        `ST/OT ตั้งสถานะได้แค่ ${ST_OT_ALLOWED_STATUSES.join('/')} เท่านั้น (ยกเลิกงานเป็นสิทธิ์ Operation)`,
      );
    }

    // IDOR Prevention Pattern (CLAUDE.md): filter ด้วย assignedTo ตอน update แล้ว
    // เช็ค count === 0 -> 404 แทนที่จะ update() เปล่าๆ ที่ filter แค่ id
    // งานที่ Operation ยกเลิกแล้ว (cancelled) และงานที่เสร็จแล้ว (completed —
    // คำตอบ A ใน #303 ข้อ 1) เป็นสถานะสุดท้ายสำหรับ ST/OT — ห้ามเขียนทับกลับ
    // (Mobile offline queue อาจส่งค่าที่เก่าเป็นชั่วโมงมา ถ้าไม่กันงานที่จบไป
    // แล้วจะ "ฟื้น" เงียบๆ) · กันใน where ของ updateMany เลย ไม่ใช่อ่านสถานะก่อน
    // แล้วค่อย update เพื่อไม่ให้มีช่องว่างระหว่างอ่านกับเขียน (race)
    //
    // TaskEvent เขียนในทรานแซกชันเดียวกับ updateMany (docs/16 §2) — lockTask
    // ล็อกแถวไว้ก่อน fromStatus จึงเป็นค่าก่อนหน้าจริงเสมอแม้มีคำขอซ้อนกัน
    //
    // ปิดงาน (docs/28 §5.4): คำขอที่ `sending` อยู่ → 409 รอผลก่อน · คำขอที่
    // `pending`/`approved` ถูกยกเลิกในทรานแซกชันเดียวกัน · เช็คเฉพาะงานของตัวเอง
    // ที่ยังไม่จบ (งานคนอื่น/จบแล้วไปตก 404/409 ด้านล่างตามเดิม ไม่เปิดเผยข้อมูล)
    const updated = await this.prisma.$transaction(async (tx) => {
      const previous = await this.lockTask(tx, id);
      const completing =
        dto.status === 'completed' &&
        previous !== null &&
        previous.assignedTo === actor.id &&
        !ST_OT_FINAL_STATUSES.includes(previous.status);
      if (completing) {
        await this.assertNoSendingRequest(tx, id);
      }
      const result = await tx.task.updateMany({
        where: {
          id,
          assignedTo: actor.id,
          status: { notIn: ST_OT_FINAL_STATUSES },
        },
        data: {
          status: dto.status,
          ...(completing ? { completedAt: new Date() } : {}),
        },
      });
      if (result.count === 0 || !previous) {
        return null;
      }
      const task = await tx.task.findUniqueOrThrow({ where: { id } });
      await this.recordStatusChange(tx, previous, task, dto, actor);
      if (completing) {
        await this.cancelPendingConfigApplyRequests(
          tx,
          task.id,
          CANCEL_REASON_TASK_COMPLETED,
        );
      }
      return task;
    });
    if (!updated) {
      // แยก 409 (เป็นเจ้าของงาน แต่งานจบไปแล้ว) ออกจาก 404 (ไม่ใช่งานของ
      // ตัวเอง/ไม่มีงานนี้) — เช็ค assignedTo ก่อนเสมอ ไม่เปิดเผยสถานะงานของ
      // คนอื่น (IDOR)
      const existing = await this.prisma.task.findUnique({ where: { id } });
      if (existing && existing.assignedTo === actor.id) {
        if (existing.status === 'cancelled') {
          throw new ConflictException(
            'งานนี้ถูกยกเลิกแล้ว ไม่สามารถเปลี่ยนสถานะได้',
          );
        }
        if (existing.status === 'completed') {
          throw new ConflictException(
            'งานนี้เสร็จแล้ว ไม่สามารถเปลี่ยนสถานะได้',
          );
        }
      }
      throw new NotFoundException(`ไม่พบงาน id ${id}`);
    }
    await this.logAudit('update', actor);
    return updated;
  }

  /**
   * `GET /tasks/{id}/events` — timeline ของงาน เรียงตามเวลาที่เกิดจริง
   * (`changedAt`) เก่าไปใหม่ · ใครเห็น Task ได้ก็เห็น timeline ได้ ใช้กฎเดียว
   * กับ `findOne()` ทุกประการ (404 ถ้าไม่เห็นงาน) ไม่มีกฎสิทธิ์ชุดที่สอง
   */
  async findEvents(id: string, actor: ActingUser): Promise<TaskEventView[]> {
    await this.findOne(id, actor);
    const events = await this.prisma.taskEvent.findMany({
      where: { taskId: id },
      orderBy: [{ changedAt: 'asc' }, { createdAt: 'asc' }],
      include: TASK_EVENT_INCLUDE,
    });
    return events.map(toEventView);
  }

  /**
   * `POST /tasks/{id}/notes` — เพิ่มบันทึกบน timeline (ไม่เปลี่ยนสถานะ) ·
   * Operation เพิ่มได้ทุกงาน · ST/OT เฉพาะงานที่ตัวเองถูก assign (404 ถ้าไม่ใช่
   * ไม่เปิดเผยว่ามีงานนี้ — IDOR) · role อื่น 403 · งาน `cancelled` แล้ว 409
   */
  async addNote(
    id: string,
    dto: CreateTaskNoteDto,
    actor: ActingUser,
  ): Promise<TaskEventView> {
    const isOperation = actor.role === OPERATION_ROLE;
    if (!isOperation && !SELF_SCOPED_ROLES.includes(actor.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เพิ่มบันทึกในงานนี้');
    }
    const note = dto.note.trim();
    if (note.length === 0) {
      throw new BadRequestException('บันทึกต้องไม่เป็นช่องว่างล้วน');
    }

    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task || (!isOperation && task.assignedTo !== actor.id)) {
      throw new NotFoundException(`ไม่พบงาน id ${id}`);
    }
    if (task.status === 'cancelled') {
      throw new ConflictException(
        'งานนี้ถูกยกเลิกแล้ว ไม่สามารถเพิ่มบันทึกได้',
      );
    }

    const event = await this.prisma.taskEvent.create({
      data: { taskId: id, changedBy: actor.id, note },
      include: TASK_EVENT_INCLUDE,
    });
    await this.logAudit('add_note', actor);
    return toEventView(event);
  }

  /**
   * ปิดงานที่ไม่มีความเคลื่อนไหวเกิน `TASK_IDLE_CLOSE_HOURS` (docs/28 D4, §5.4,
   * A ตอบ Q3 บน #382) — ใช้กับงานทั้งสอง `source` · เงื่อนไขทั้งหมด:
   * - สถานะ `in_progress` และ `updatedAt` เก่ากว่าเส้นตัด
   * - ไม่มี TaskEvent (บันทึก/เปลี่ยนสถานะ) ตั้งแต่เส้นตัด
   * - ไม่มีคำขอส่ง Config ที่ `sending` อยู่ หรือขยับตั้งแต่เส้นตัด (คำขอที่เพิ่ง
   *   อนุมัติยังมีเวลากดส่ง)
   * - `dueDate` ว่างหรือเลยแล้ว (Operation ตั้งกำหนดยาวกว่า 24 ชม. ไว้ตั้งใจ)
   *
   * แต่ละงานล็อกแถวแล้วเช็คซ้ำในทรานแซกชันก่อนปิด (ช่างอาจกดอะไรพร้อมกันพอดี)
   * · คืนจำนวนงานที่ปิด
   */
  async autoCloseIdle(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - TASK_IDLE_CLOSE_HOURS * HOUR_MS);
    const idleWhere: Prisma.TaskWhereInput = {
      status: 'in_progress',
      updatedAt: { lt: cutoff },
      events: { none: { changedAt: { gte: cutoff } } },
      configApplyRequests: {
        none: { OR: [{ status: 'sending' }, { updatedAt: { gte: cutoff } }] },
      },
      OR: [{ dueDate: null }, { dueDate: { lt: now } }],
    };
    const candidates = await this.prisma.task.findMany({
      where: idleWhere,
      select: { id: true },
    });
    let closed = 0;
    for (const { id } of candidates) {
      const done = await this.prisma.$transaction(async (tx) => {
        await this.lockTask(tx, id);
        const result = await tx.task.updateMany({
          where: { id, ...idleWhere },
          data: { status: 'completed', completedAt: now, autoClosed: true },
        });
        if (result.count === 0) {
          return false;
        }
        await tx.taskEvent.create({
          data: {
            taskId: id,
            fromStatus: 'in_progress',
            toStatus: 'completed',
            changedBy: null,
            changedAt: now,
            note: `ระบบปิดงานให้ (ไม่มีความเคลื่อนไหว ${TASK_IDLE_CLOSE_HOURS} ชม.)`,
          },
        });
        await this.cancelPendingConfigApplyRequests(
          tx,
          id,
          CANCEL_REASON_TASK_COMPLETED,
        );
        return true;
      });
      if (done) {
        closed += 1;
      }
    }
    return closed;
  }

  /**
   * ปิดงานระหว่างที่คำขอส่งเข้ากล่องยัง `sending` อยู่ไม่ได้ (docs/28 §5.4) —
   * ปิดกลางทางแล้วผลจากกล่องกลับมาจะไม่มีใครเห็นในงานที่เปิดอยู่ · เรียกหลัง
   * `lockTask` ในทรานแซกชันเดียวกัน
   */
  private async assertNoSendingRequest(
    tx: Prisma.TransactionClient,
    taskId: string,
  ): Promise<void> {
    const sending = await tx.configApplyRequest.findFirst({
      where: { taskId, status: 'sending' },
      select: { id: true },
    });
    if (sending) {
      throw new ConflictException(
        'กำลังส่งเข้ากล่องอยู่ — รอผลจากกล่องก่อนแล้วค่อยกดเสร็จงาน',
      );
    }
  }

  /**
   * ปิดคำขอส่ง Config ของงานนี้ที่ยัง `pending` หรือ `approved` (docs/27 —
   * อนุมัติแล้วแต่ยังไม่กดส่ง) ตามไปด้วย ในทรานแซกชันเดียวกับการเปลี่ยนสถานะงาน
   * — ตอนงานถูกยกเลิก (docs/25 §3.9 มติ Q9) และตอนปิดงาน (docs/28 §5.4) · คำขอ
   * ที่ `sending` แล้วไม่แตะ (สั่งกล่องไปแล้ว รอผลจากกล่องตามเดิม)
   */
  private async cancelPendingConfigApplyRequests(
    tx: Prisma.TransactionClient,
    taskId: string,
    reason: string,
  ): Promise<void> {
    await tx.configApplyRequest.updateMany({
      where: { taskId, status: { in: ['pending', 'approved'] } },
      data: {
        status: 'cancelled',
        resultDetail: reason,
        completedAt: new Date(),
      },
    });
  }

  /**
   * ล็อกแถว Task ไว้จนจบทรานแซกชัน (`SELECT ... FOR UPDATE`) แล้วคืนสถานะก่อน
   * แก้ — ใช้เป็น `fromStatus` ของ event · `null` ถ้าไม่มีงานนี้
   */
  private async lockTask(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LockedTask | null> {
    const rows = await tx.$queryRaw<LockedTask[]>`
      SELECT "status", "createdAt", "assignedTo" FROM "Task" WHERE "id" = ${id} FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  /**
   * เขียน event เปลี่ยนสถานะ — เฉพาะเมื่อ PATCH นี้ส่ง status มาและเปลี่ยนจริง
   * (ส่งสถานะเดิมซ้ำ เช่น offline queue ส่งซ้ำ ไม่เกิด event)
   *
   * `changedAt` จาก client ใช้เฉพาะ ST/OT (มาจากคิว offline ของ Mobile) —
   * Operation ใช้เวลา server เสมอแม้ส่งมา เพราะ Web ไม่มีคิว offline ไม่มี
   * เหตุผลต้องส่งเวลาเอง (รีวิว A บน PR #302)
   */
  private async recordStatusChange(
    tx: Prisma.TransactionClient,
    previous: LockedTask,
    task: Task,
    dto: UpdateTaskDto,
    actor: ActingUser,
  ): Promise<void> {
    if (dto.status === undefined || task.status === previous.status) {
      return;
    }
    const changedAt = SELF_SCOPED_ROLES.includes(actor.role)
      ? resolveChangedAt(
          dto.changedAt,
          await this.statusChangeLowerBound(tx, task.id, previous.createdAt),
        )
      : new Date();
    await tx.taskEvent.create({
      data: {
        taskId: task.id,
        fromStatus: previous.status,
        toStatus: task.status,
        changedBy: actor.id,
        changedAt,
      },
    });
  }

  /**
   * ขอบล่างของ `changedAt` ที่ client ส่งมา = `max(Task.createdAt, changedAt
   * ของ event เปลี่ยนสถานะล่าสุดของงานนี้)` (รีวิว A บน PR #302) — ถ้ามีคน
   * เปลี่ยนสถานะคั่นระหว่างที่ช่างออฟไลน์ event ของช่างที่ sync ขึ้นทีหลังต้อง
   * ไม่ย้อนไปอยู่ก่อน event นั้น ไม่งั้น timeline จะเรียง from→to ต่อกันไม่ติด
   * (เวลาอาจคลาดจากเวลากดจริงบ้าง แต่ลำดับถูกเสมอ) · เรียกหลัง `lockTask`
   * ในทรานแซกชันเดียวกัน แถวงานถูกล็อกอยู่ จึงไม่มี event ใหม่แทรกระหว่างนี้
   */
  private async statusChangeLowerBound(
    tx: Prisma.TransactionClient,
    taskId: string,
    taskCreatedAt: Date,
  ): Promise<Date> {
    const latest = await tx.taskEvent.findFirst({
      where: { taskId, toStatus: { not: null } },
      orderBy: { changedAt: 'desc' },
      select: { changedAt: true },
    });
    if (!latest || latest.changedAt.getTime() < taskCreatedAt.getTime()) {
      return taskCreatedAt;
    }
    return latest.changedAt;
  }

  // issue #73 ข้อ 3 — เดิมเช็คแค่ "ST/OT ที่ไม่ใช่เจ้าของงาน" ซ่อน ที่เหลือ
  // (default-allow) เห็นได้หมด ไม่ว่า role นั้นจะมี use case จริงหรือไม่ —
  // ไม่มี PermissionGuard คุม `GET /tasks/{id}` เลย (แค่ JwtAuthGuard) จุดนี้
  // จึงเป็นด่านเดียวที่กันได้ เปลี่ยนเป็น allowlist แบบเดียวกับ findAll():
  // UNSCOPED_TASK_ROLES เห็นได้หมด, SELF_SCOPED_ROLES เห็นเฉพาะงานตัวเอง,
  // role อื่นที่ไม่อยู่ใน 2 list นี้เลย (เช่น role ใหม่ที่ได้ grant tasks:Read
  // เพิ่มทีหลังโดยไม่ได้ตั้งใจ) ถูกซ่อนเสมอ (default-deny)
  private isHiddenFromActor(task: Task, actor: ActingUser): boolean {
    if (UNSCOPED_TASK_ROLES.includes(actor.role)) {
      return false;
    }
    if (SELF_SCOPED_ROLES.includes(actor.role)) {
      return task.assignedTo !== actor.id;
    }
    return true;
  }

  private touchesNonStatusField(dto: UpdateTaskDto): boolean {
    return [
      dto.title,
      dto.description,
      dto.assignedTo,
      dto.deviceId,
      dto.configId,
      dto.dueDate,
    ].some((value) => value !== undefined);
  }

  /**
   * แจ้ง user ที่ถูก assign งาน (`task_assigned`). **Never throws** — push ที่
   * ล้มเหลวต้องไม่ทำให้ทั้ง request create/update Task ล้มตาม (ผู้ใช้เห็นผลของ
   * DB write ที่สำเร็จจริง ไม่ใช่ผลของ notification) `NotificationService.send()`
   * catch/degrade ส่วนใหญ่ให้อยู่แล้ว — try/catch ตรงนี้เป็นชั้นกันเพิ่ม.
   */
  private async notifyTaskAssigned(task: Task): Promise<void> {
    try {
      await this.notificationService.send({
        userId: task.assignedTo,
        type: 'task_assigned',
        payload: { taskId: task.id, title: task.title },
      });
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน task_assigned ไม่สำเร็จ (task ${task.id}, user ${task.assignedTo}): ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * เขียน AuditLog (CLAUDE.md Audit Pattern — "สร้าง"/"แก้ไข", Sprint 3 #27
   * follow-up ของ PR #145) **Never throws** — มติค้างกับ A ว่า
   * `config.service.ts` เขียนแบบ unguarded await (audit ล้มเหลว = 500 ทั้งที่
   * mutation จริงสำเร็จไปแล้ว) ยังไม่ได้ข้อสรุป โมดูลนี้เลือก wrap ด้วย
   * try/catch แบบเดียวกับ `notifyTaskAssigned` แทน (ผู้ใช้เห็นผลของ DB write
   * ที่สำเร็จจริง ไม่ใช่ผลของ audit log)
   */
  private async logAudit(action: string, actor: ActingUser): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action,
          ipAddress: actor.ipAddress,
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action ${action}, user ${actor.id}): ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * ตรวจ Config ที่ Operation จะผูกกับงาน — mirror เงื่อนไขของ
   * DeviceService.applyConfig เพื่อไม่ให้ผูก Config ที่ apply-config จะปฏิเสธ
   * ทีหลังตอนช่างกดยืนยันหน้างาน:
   * - Config ต้องมีอยู่จริง → 404
   * - Config ต้อง approved/synced → 409
   * - ถ้า Task มี deviceId และมี Device record จริงสำหรับเลขนั้น: deviceModel/
   *   protocol ของ Config ต้องตรงกับ Device → 409
   *
   * `deviceId` ที่ยังไม่มี Device record (อ้างลอยๆ ตามที่ Task.deviceId เป็น
   * อยู่ตอนนี้) ข้ามการเช็ครุ่นไป — Device Registration ยังเป็น Phase 5
   */
  private async assertConfigAssignable(
    configId: string,
    deviceId: string | null | undefined,
  ): Promise<void> {
    const config = await this.prisma.config.findUnique({
      where: { id: configId },
    });
    if (!config) {
      throw new NotFoundException(`ไม่พบ Config id ${configId}`);
    }
    if (!CONFIG_STATUSES_ASSIGNABLE_TO_TASK.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังผูกกับงานไม่ได้ — ต้องผ่านการอนุมัติ (${CONFIG_STATUSES_ASSIGNABLE_TO_TASK.join('/')}) ก่อน`,
      );
    }
    if (deviceId == null) {
      return;
    }
    // Task.deviceId เป็นเลขเครื่องจริง (Device.deviceId) ไม่ใช่ Device.id
    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    if (!device) {
      return;
    }
    if (
      config.deviceModel !== device.deviceModel ||
      config.protocol !== device.protocol
    ) {
      throw new ConflictException(
        `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับอุปกรณ์ ${device.deviceModel}/${device.protocol}`,
      );
    }
  }
}
