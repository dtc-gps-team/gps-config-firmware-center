import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigStatus, Task } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

/** AuditLog.auditModule ของทุกแถวที่โมดูลนี้เขียน (Sprint 3 #27 follow-up —
 * PR #145 เปิดโมดูล `audit`/`GET /audit-logs` แล้วแต่ task/notification ยังไม่
 * เขียน) — mirror ชื่อ module string ของ `config.service.ts`/`device.service.ts` */
const AUDIT_MODULE = 'task';

const OPERATION_ROLE = 'Operation';
// ST/OT = ผู้ใช้ Mobile ที่เห็น/แก้ได้เฉพาะงานที่ตัวเองถูก assign เท่านั้น
// (ดู docs/architecture/RBAC_Matrix.md Section 4.3 และ Section 5 ข้อ 8)
const SELF_SCOPED_ROLES: readonly string[] = ['ST', 'OT'];

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
const UNSCOPED_TASK_ROLES: readonly string[] = [
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

// สถานะ Config ที่ Operation ผูกกับงานติดตั้งได้ — ต้องผ่าน Operation อนุมัติ
// มาแล้วเท่านั้น (`approved` = อนุมัติแล้ว, `synced` = เขียนเข้าระบบเดิมแล้ว)
// ตรงกับ APPLICABLE_CONFIG_STATUSES ใน src/device/config-applier.ts (เงื่อนไข
// ของ POST /devices/{deviceId}/apply-config ที่ Mobile จะเรียกต่อ) — ทำสำเนา
// ไว้ในโมดูล task เพื่อไม่ให้ task (โมดูล B) ผูก import ข้ามไป device (โมดูล A)
const CONFIG_STATUSES_ASSIGNABLE_TO_TASK: readonly ConfigStatus[] = [
  'approved',
  'synced',
];

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
    const created = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        assignedTo: dto.assignedTo,
        deviceId: dto.deviceId,
        configId: dto.configId,
        dueDate: toDbDate(dto.dueDate),
      },
    });
    // งานใหม่ทุกงานมีคนถูก assign เสมอ (assignedTo required ใน CreateTaskDto)
    await this.notifyTaskAssigned(created);
    await this.logAudit('create', actor);
    return created;
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
        updated = await this.prisma.task.update({
          where: { id },
          data: {
            title: dto.title,
            description: dto.description,
            assignedTo: dto.assignedTo,
            deviceId: dto.deviceId,
            configId: dto.configId,
            status: dto.status,
            dueDate: toDbDate(dto.dueDate),
          },
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
    const result = await this.prisma.task.updateMany({
      where: { id, assignedTo: actor.id },
      data: { status: dto.status },
    });
    if (result.count === 0) {
      throw new NotFoundException(`ไม่พบงาน id ${id}`);
    }
    await this.logAudit('update', actor);
    return this.prisma.task.findUniqueOrThrow({ where: { id } });
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
        data: { userId: actor.id, auditModule: AUDIT_MODULE, action },
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
