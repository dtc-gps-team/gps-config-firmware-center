import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Config,
  ConfigApplyRequest,
  ConfigApplyRequestStatus,
  ConfigStatus,
  Device,
  FieldApplyKind,
  Firmware,
  NotificationType,
  Prisma,
  Task,
} from '@prisma/client';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import { RolloutEvents } from '../campaign/rollout-events';
import { CentralDeviceService } from '../central-device/central-device.service';
import { omitHiddenConfigFields } from '../central-device/hidden-config-fields';
import {
  CONFIG_APPLY_MODE,
  type ConfigApplyMode,
} from '../device/config-applier';
import { mergeApprovedOverride } from '../device/config-override-merge';
import {
  CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS,
  SIMULATABLE_FIRMWARE_STATUS,
} from '../firmware/firmware-status';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, TaskService } from '../task/task.service';
import {
  CONFIG_APPLY_APPROVAL_TTL_HOURS,
  CONFIG_APPLY_REQUEST_TTL_HOURS,
  OPEN_CONFIG_APPLY_REQUEST_STATUSES,
} from './config-apply-request-status';
import { CreateConfigApplyRequestDto } from './dto/create-config-apply-request.dto';
import { RejectConfigApplyRequestDto } from './dto/reject-config-apply-request.dto';
import {
  FIELD_APPLY_RESULT_EVENT,
  FIELD_APPLY_ROLLOUT_STARTER,
  type FieldApplyResultEvent,
  type FieldApplyRolloutPayload,
  type FieldApplyRolloutStarter,
} from './field-apply-rollout';
import { compareFirmwareVersions } from './firmware-version';

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

/** ยกเลิกได้ตอนยังไม่ส่ง (docs/27 §5.5) / หมดอายุได้ (docs/27 D2) */
const CANCELLABLE_STATUSES: ConfigApplyRequestStatus[] = [
  'pending',
  'approved',
];
const EXPIRABLE_STATUSES = CANCELLABLE_STATUSES;

const HOUR_MS = 60 * 60 * 1000;

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
  releaser: { select: { id: true, fullName: true } },
  firmware: { select: { id: true, version: true } },
  // docs/30 — Override ที่คำขอนี้พาเข้ากล่อง · ค่าจริงไม่ออกในคิว (แค่ชื่อ field
  // ผ่าน `fieldNames` ของ view) Web ดูค่าผ่าน GET /device-config-overrides/{id}
  override: { select: { id: true, reason: true, fields: true } },
} satisfies Prisma.ConfigApplyRequestInclude;

type RequestWithRelations = Prisma.ConfigApplyRequestGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

/** แถวของคิวอนุมัติ (`GET /config-apply-requests`) — ข้อมูลที่การ์ด Approval
 * Center ใช้ (§3.4) · `fieldNames` เป็นชื่อ field ที่จะส่ง (รวม Device Config
 * Override ที่ approved) **ไม่มีค่าจริง** (หลักเดียวกับ AuditLog metadata) ·
 * คำขอ Firmware (docs/27 §5.2): `config` null, `fieldNames` ว่าง, ใช้ `firmware`
 * + `fromFirmwareVersion` + `isDowngrade` แทน */
export type ConfigApplyRequestView = Omit<
  RequestWithRelations,
  'config' | 'override'
> & {
  config: Omit<NonNullable<RequestWithRelations['config']>, 'fields'> | null;
  fieldNames: string[];
  /** docs/30 — null = คำขอปกติ · `fieldNames` = field ที่ Override แก้ */
  override: { id: string; reason: string; fieldNames: string[] } | null;
};

/** `GET /tasks/{taskId}/config-apply-requests` — แถวคำขอ + เวอร์ชัน Firmware ให้
 * Mobile แสดง "Firmware vX" ได้โดยไม่ต้องเรียก API อื่น (docs/27 B2) */
const TASK_REQUEST_INCLUDE = {
  firmware: { select: { id: true, version: true } },
  // docs/30 — ค่าที่ช่างขอ Override (ช่างกรอกเอง ดูค่าได้) ให้การ์ดหน้างานแสดง
  override: { select: { id: true, reason: true, fields: true } },
} satisfies Prisma.ConfigApplyRequestInclude;

export type TaskRequestView = Prisma.ConfigApplyRequestGetPayload<{
  include: typeof TASK_REQUEST_INCLUDE;
}>;

/** สิ่งที่ต่างกันระหว่างคำขอ 2 ชนิดตอนสร้าง — ที่เหลือ (Task, เครื่อง, เวลา) ใช้ร่วมกัน */
type RequestPayloadDraft =
  | { kind: 'config'; configId: string; configAssignedBy: string | null }
  | {
      kind: 'firmware';
      firmwareId: string;
      fromFirmwareVersion: string | null;
      isDowngrade: boolean;
    };

/** 1 ตัวเลือก Config ใน `GET /devices/{deviceId}/apply-options` (docs/28 §5.2) */
export interface ApplyOptionConfig {
  id: string;
  name: string;
  status: ConfigStatus;
  /** `ConfigVersion.versionNumber` ล่าสุด (0 = ยังไม่มีเวอร์ชัน) — ตัวเดียวกับที่
   * snapshot ตอนอนุมัติ */
  latestVersion: number;
  /** Config ที่ Operation ผูกไว้กับงานที่ช่างเปิดอยู่ของกล่องนี้ (docs/28 D5) */
  suggested: boolean;
  /** ค่าที่จะส่งเข้ากล่องนี้ = Config + Override ที่อนุมัติแล้วล่าสุดของกล่องกับ
   * Config ตัวนี้ (merge แบบเดียวกับตอนส่ง) ให้ช่างดูก่อนเลือก */
  fields: Record<string, unknown>;
}

/** 1 ตัวเลือก Firmware ใน `GET /devices/{deviceId}/apply-options` (docs/27 B2) */
export interface ApplyOptionFirmware {
  id: string;
  version: string;
  /** ตรงกับเวอร์ชันที่กล่องรายงานอยู่ — ขอไม่ได้ (create ตอบ 409) */
  isCurrent: boolean;
  /** ต่ำกว่าเวอร์ชันที่กล่องรายงาน — ขอได้แต่ Mobile ต้องถามยืนยันก่อน (D5) */
  isDowngrade: boolean;
}

/** คำขอที่ยังไม่จบของกล่องนี้ใน `GET /devices/{deviceId}/apply-options` — ขอใหม่
 * ไม่ได้จนกว่าคำขอนี้จะจบ (create ตอบ 409) Mobile จึงบอกช่างตั้งแต่เปิดหน้าเลือก */
export interface ApplyOptionOpenRequest {
  kind: FieldApplyKind;
  status: ConfigApplyRequestStatus;
  configName: string | null;
  firmwareVersion: string | null;
  /** งานของคำขอนี้ — `null` เมื่อผู้เรียกไม่ได้ถืองานนั้น (ไม่เปิดเผยงานของช่างคนอื่น) */
  taskId: string | null;
}

/** `GET /devices/{deviceId}/apply-options` (docs/28 §5.2, docs/27 B2) */
export interface ApplyOptions {
  deviceId: string;
  /** ส่งเข้ากล่องได้เฉพาะเครื่อง `installed` — Mobile ใช้บอกช่างก่อนกดขอ */
  deviceInstalled: boolean;
  configs: ApplyOptionConfig[];
  /** เวอร์ชัน Firmware ที่กล่องรายงานกับ Server กลาง · `null` = ไม่รู้ (โหมดที่ไม่มี
   * Server กลาง / ติดต่อไม่ได้ / Server กลางไม่รู้จักกล่อง) — `isCurrent`/
   * `isDowngrade` เป็น `false` ทั้งหมด และ create ของโหมด central จะตอบ error เอง */
  currentFirmwareVersion: string | null;
  /** Firmware ที่ QA อนุมัติแล้ว + อัปโหลดสำเร็จ + รองรับรุ่นกล่อง ใหม่สุดก่อน */
  firmwares: ApplyOptionFirmware[];
  /** คำขอที่ยังไม่จบของกล่องนี้ (`pending`/`approved`/`sending`) · `null` = ขอใหม่ได้ */
  openRequest: ApplyOptionOpenRequest | null;
}

// งานที่ยังเปิดอยู่ — ใช้หา Config แนะนำ (mirror `OPEN_TASK_STATUSES` ใน task.service.ts)
const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const;

/** `Json` ของ Config/Override เป็น map ชื่อ field -> ค่า (ไม่ใช่ object = ว่าง) */
function asFieldMap(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/**
 * คำขอ "ส่ง Config ของ Task เข้าเครื่องจริง" (docs/25, PR #364) — ช่างขอ,
 * Operation **อีกคน** อนุมัติ แล้ว**ช่างที่ถือ Task กดส่งเอง** (docs/27) ระบบจึง
 * สร้าง Rollout เครื่องเดียวส่งผ่านเส้นทางเดียวกับ Campaign (ทาง ค.)
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
    private readonly centralDevices: CentralDeviceService,
    @Inject(CONFIG_APPLY_MODE) private readonly applyMode: ConfigApplyMode,
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
   * `POST /tasks/{taskId}/config-apply-requests` (§3.3, docs/28 §5.3) — เครื่อง
   * มาจาก Task เสมอ · Config = `dto.configId` (ช่างเลือกเอง) หรือ `Task.configId`
   * ถ้าไม่ส่ง · ขอ Config **ตัวเดียวกับที่ Operation ผูกไว้** = snapshot
   * `configAssignedBy` (SoD ข้อ 3 ใช้กับคนผูก, ไม่รู้คนผูก = fail closed) · Config
   * ที่ช่างเลือกเอง = `configAssignedBy` null
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
        `งานต้องอยู่สถานะกำลังทำ (in_progress) ถึงจะขอส่งเข้ากล่องได้ — สถานะปัจจุบัน: ${task.status}`,
      );
    }
    if (!task.deviceId) {
      throw new ConflictException(
        'งานนี้ไม่มีเครื่องที่ผูกไว้ ขอส่งเข้ากล่องไม่ได้',
      );
    }
    const deviceId = task.deviceId;
    if (dto.direct && dto.kind === 'firmware') {
      throw new BadRequestException(
        'ส่ง Firmware โดยไม่ผ่านการอนุมัติไม่ได้ — ส่งเฉพาะ Config ที่อนุมัติแล้วได้เท่านั้น',
      );
    }
    // `kind=firmware` (docs/27 §5.1, B2) — Firmware ต้องส่งได้ · โหมด central อ่าน
    // เวอร์ชันที่กล่องรายงานจาก Server กลาง: เท่ากับที่ขอ 409, ต่ำกว่า =
    // `isDowngrade`, ติดต่อไม่ได้ 503 (fail closed — ไม่รู้ว่าถอยหรือไม่)
    const draft: RequestPayloadDraft =
      dto.kind === 'firmware'
        ? await this.prepareFirmwareRequest(dto, deviceId)
        : await this.prepareConfigRequest(dto, task, deviceId);

    const direct = dto.direct === true;
    const created = await this.prisma.$transaction((tx) =>
      this.insertRequest(
        tx,
        { taskId, deviceId, ...draft, note: dto.note?.trim() || null },
        actor,
        direct,
      ),
    );

    // ส่งตรง: ไม่มีอะไรให้ Operation อนุมัติ
    if (!direct) await this.notifyOperations(created);
    return created;
  }

  /**
   * docs/30 — ช่างขอ Config Override ในโหมด central = สร้างคำขอส่งเข้ากล่องผูกกัน
   * **ในทรานแซกชันเดียวกับ Override** (`DeviceService.overrideDeviceConfig()`
   * ส่ง `tx` มา) · Config = Config ปัจจุบันของเครื่อง (base ของ Override) · กฎ
   * เดียวกับ `create()`: งานต้องเป็นของช่างและกำลังทำ, Config ส่งเข้ากล่องนี้ได้,
   * เครื่องไม่มีคำขอค้าง (409 → Override rollback ไปด้วย) · ผู้เรียกต้องเรียก
   * `notifyCreated()` หลัง commit
   */
  async createForOverride(
    tx: Prisma.TransactionClient,
    args: { task: Task; configId: string; overrideId: string },
    actor: ActingUser,
  ): Promise<ConfigApplyRequest> {
    const { task, configId, overrideId } = args;
    if (task.assignedTo !== actor.id || task.status !== 'in_progress') {
      throw new ConflictException(
        'งานของกล่องนี้ต้องเป็นของคุณและอยู่สถานะกำลังทำ ถึงจะขอแก้ค่าได้',
      );
    }
    if (!task.deviceId) {
      throw new ConflictException('งานนี้ไม่มีเครื่องที่ผูกไว้');
    }
    const usesAssignedConfig = configId === task.configId;
    if (usesAssignedConfig && !task.configAssignedBy) {
      throw new ConflictException(
        'งานนี้ยังไม่มีข้อมูลผู้ผูก Config ให้ Operation ผูก Config ใหม่ก่อน',
      );
    }
    await this.assertApplicable(tx, configId, task.deviceId, 'create');
    return this.insertRequest(
      tx,
      {
        taskId: task.id,
        deviceId: task.deviceId,
        kind: 'config',
        configId,
        configAssignedBy: usesAssignedConfig ? task.configAssignedBy : null,
        overrideId,
        note: null,
      },
      actor,
    );
  }

  /** แจ้ง Operation ว่ามีคำขอใหม่ — ใช้หลัง `createForOverride()` commit แล้ว */
  async notifyCreated(request: ConfigApplyRequest): Promise<void> {
    await this.notifyOperations(request);
  }

  /** ส่วนในทรานแซกชันของการสร้างคำขอ — lock เครื่อง, ห้ามมีคำขอ/Rollout ค้าง,
   * ตั้งเส้นตาย, AuditLog · ใช้ร่วมกันโดย `create()` และ `createForOverride()`
   *
   * `direct` (Config ที่อนุมัติแล้ว ไม่แก้ค่า) — เกิดเป็น `approved` ทันทีด้วยค่า
   * เดียวกับตอน Operation อนุมัติ (snapshot เวอร์ชัน Config, เส้นตายแบบอนุมัติ
   * แล้ว) แต่ `decidedBy` null = ไม่มีคนอนุมัติ · AuditLog `config_apply_direct` */
  private async insertRequest(
    tx: Prisma.TransactionClient,
    data: RequestPayloadDraft & {
      taskId: string;
      deviceId: string;
      note: string | null;
      overrideId?: string;
    },
    actor: ActingUser,
    direct = false,
  ): Promise<ConfigApplyRequest> {
    const { deviceId } = data;
    await this.lockDevice(tx, deviceId);
    const open = await tx.configApplyRequest.findFirst({
      where: { deviceId, status: { in: OPEN_CONFIG_APPLY_REQUEST_STATUSES } },
    });
    if (open) {
      throw new ConflictException(
        `เครื่องนี้มีคำขอส่ง ${open.kind === 'firmware' ? 'Firmware' : 'Config'} ที่ยังไม่จบอยู่แล้ว — รอผลหรือยกเลิกคำขอเดิมก่อน`,
      );
    }
    await this.assertNoOpenRolloutTarget(tx, deviceId);

    const now = new Date();
    const directApproval =
      direct && data.kind === 'config'
        ? {
            status: 'approved' as const,
            decidedBy: null,
            decidedAt: now,
            approvedConfigVersion: await this.latestConfigVersion(
              tx,
              data.configId,
            ),
          }
        : null;
    const ttlHours = directApproval
      ? CONFIG_APPLY_APPROVAL_TTL_HOURS
      : CONFIG_APPLY_REQUEST_TTL_HOURS;
    const request = await tx.configApplyRequest.create({
      data: {
        ...data,
        ...directApproval,
        requestedBy: actor.id,
        requestedAt: now,
        expiresAt: new Date(now.getTime() + ttlHours * HOUR_MS),
      },
    });
    await this.writeAudit(
      tx,
      directApproval ? 'config_apply_direct' : 'config_apply_request',
      actor,
      request,
    );
    return request;
  }

  /**
   * docs/30 §3 — ปิด Override ที่ผูกกับคำขอที่จบก่อนได้รับอนุมัติ (ปฏิเสธ /
   * ช่างยกเลิก / หมดอายุ) เป็น `rejected` ในทรานแซกชันเดียวกัน · คำขอที่อนุมัติ
   * แล้ว Override เป็น approved ไปแล้ว ไม่แตะ (ค่าถูกอนุมัติแล้ว จะติดไปกับการ
   * ส่ง Config ตัวนี้ครั้งถัดไปตามพฤติกรรม merge เดิม)
   */
  private async closeLinkedOverride(
    tx: Prisma.TransactionClient,
    request: ConfigApplyRequest,
    reason: string,
    decidedBy: string | null,
  ): Promise<void> {
    if (!request.overrideId) return;
    await tx.deviceConfigOverride.updateMany({
      where: { id: request.overrideId, status: 'pending' },
      data: {
        status: 'rejected',
        rejectReason: reason,
        decidedBy,
        decidedAt: new Date(),
      },
    });
  }

  /** ส่วน Config ของ `create()` — Config = `dto.configId` หรือ `Task.configId` */
  private async prepareConfigRequest(
    dto: CreateConfigApplyRequestDto,
    task: Task,
    deviceId: string,
  ): Promise<RequestPayloadDraft> {
    if (dto.firmwareId) {
      throw new BadRequestException(
        'คำขอส่ง Config ไม่รับ firmwareId — ส่ง kind: firmware ถ้าต้องการส่ง Firmware',
      );
    }
    const configId = dto.configId ?? task.configId;
    if (!configId) {
      throw new BadRequestException(
        'เลือก Config ที่จะส่งเข้ากล่องก่อน (งานนี้ไม่มี Config ที่ Operation ผูกไว้)',
      );
    }
    const usesAssignedConfig = configId === task.configId;
    // fail closed (§4.2): ขอ Config ที่ผูกไว้กับงานเก่าก่อนมี configAssignedBy —
    // ไม่รู้ว่าใครผูก จึงเช็ค SoD ข้อ 3 ไม่ได้
    if (usesAssignedConfig && !task.configAssignedBy) {
      throw new ConflictException(
        'งานนี้ยังไม่มีข้อมูลผู้ผูก Config ให้ Operation ผูก Config ใหม่ก่อน หรือเลือก Config ตัวอื่น',
      );
    }
    await this.assertApplicable(this.prisma, configId, deviceId, 'create');
    return {
      kind: 'config',
      configId,
      configAssignedBy: usesAssignedConfig ? task.configAssignedBy : null,
    };
  }

  /** ส่วน Firmware ของ `create()` (docs/27 §5.1) */
  private async prepareFirmwareRequest(
    dto: CreateConfigApplyRequestDto,
    deviceId: string,
  ): Promise<RequestPayloadDraft> {
    if (dto.configId) {
      throw new BadRequestException(
        'คำขอส่ง Firmware ไม่รับ configId — ส่งได้ทีละอย่างต่อคำขอ',
      );
    }
    if (!dto.firmwareId) {
      throw new BadRequestException(
        'เลือก Firmware ที่จะส่งเข้ากล่องก่อน (firmwareId)',
      );
    }
    const { firmware } = await this.assertFirmwareApplicable(
      this.prisma,
      dto.firmwareId,
      deviceId,
      'create',
    );
    const fromFirmwareVersion =
      await this.readReportedFirmwareVersion(deviceId);
    const order =
      fromFirmwareVersion === null
        ? null
        : compareFirmwareVersions(firmware.version, fromFirmwareVersion);
    if (order === 0) {
      throw new ConflictException(
        `กล่องรัน Firmware v${fromFirmwareVersion} อยู่แล้ว ไม่ต้องส่งซ้ำ`,
      );
    }
    return {
      kind: 'firmware',
      firmwareId: firmware.id,
      fromFirmwareVersion,
      isDowngrade: order !== null && order < 0,
    };
  }

  /** `GET /tasks/{taskId}/config-apply-requests` — ใครเห็น Task ได้ก็เห็นคำขอของ
   * Task นั้น (กฎเดียวกับ `GET /tasks/{id}`, §3.3) ใหม่สุดขึ้นก่อน */
  async listForTask(
    taskId: string,
    actor: ActingUser,
  ): Promise<TaskRequestView[]> {
    await this.taskService.findOne(taskId, actor);
    return this.prisma.configApplyRequest.findMany({
      where: { taskId },
      orderBy: { requestedAt: 'desc' },
      include: TASK_REQUEST_INCLUDE,
    });
  }

  /**
   * `GET /devices/{deviceId}/apply-options` (docs/28 §5.2) — Config ที่ช่าง
   * เลือกส่งเข้ากล่องนี้ได้: สถานะ `approved`/`synced` ไม่ถูกลบ รุ่น+โปรโตคอลตรง
   * กับกล่อง (กฎเดียวกับ `assertApplicable()` ที่ตรวจซ้ำตอนสร้างคำขอ) · ตัวที่
   * Operation ผูกไว้กับงานที่ช่างเปิดอยู่ของกล่องนี้ขึ้นก่อน (`suggested`) ที่
   * เหลือเรียงตามชื่อ · กล่องไม่พบ 404
   */
  async applyOptions(
    deviceId: string,
    actor: ActingUser,
  ): Promise<ApplyOptions> {
    const device = await this.prisma.device.findUnique({ where: { deviceId } });
    if (!device) {
      throw new NotFoundException(`ไม่พบเครื่อง ${deviceId}`);
    }
    const openTask = await this.prisma.task.findFirst({
      where: {
        assignedTo: actor.id,
        deviceId,
        status: { in: [...OPEN_TASK_STATUSES] },
        configId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { configId: true },
    });
    const suggestedId = openTask?.configId ?? null;
    const configs = await this.prisma.config.findMany({
      where: {
        status: { in: [...APPLICABLE_CONFIG_STATUSES] },
        deletedAt: null,
        deviceModel: device.deviceModel,
        protocol: device.protocol,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        fields: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true },
        },
      },
    });
    // Override ที่อนุมัติแล้วของกล่องนี้ — แถวล่าสุดต่อ Config เก็บค่าสะสมไว้แล้ว
    // (เหมือน `mergeApprovedOverride`) query เดียวแทนทีละ Config
    const overrides = configs.length
      ? await this.prisma.deviceConfigOverride.findMany({
          where: {
            deviceId,
            status: 'approved',
            configId: { in: configs.map((c) => c.id) },
          },
          orderBy: { versionNumber: 'desc' },
          select: { configId: true, fields: true },
        })
      : [];
    const latestOverride = new Map<string, Record<string, unknown>>();
    for (const o of overrides) {
      if (!latestOverride.has(o.configId)) {
        latestOverride.set(o.configId, asFieldMap(o.fields));
      }
    }
    const options = configs.map((config): ApplyOptionConfig => ({
      id: config.id,
      name: config.name,
      status: config.status,
      latestVersion: config.versions[0]?.versionNumber ?? 0,
      suggested: config.id === suggestedId,
      fields: omitHiddenConfigFields({
        ...asFieldMap(config.fields),
        ...latestOverride.get(config.id),
      }),
    }));
    options.sort((a, b) => Number(b.suggested) - Number(a.suggested));

    // Firmware (docs/27 B2) — เงื่อนไขเดียวกับ `assertFirmwareApplicable()` ·
    // เวอร์ชันปัจจุบันของกล่องเป็นข้อมูลเสริม อ่านไม่ได้ก็ยังตอบรายการได้
    const firmwares = await this.prisma.firmware.findMany({
      where: {
        uploadStatus: SIMULATABLE_FIRMWARE_STATUS,
        approvalStatus: CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS,
        deviceModelCompatibility: { has: device.deviceModel },
      },
      select: { id: true, version: true },
    });
    const currentFirmwareVersion =
      await this.tryReadReportedFirmwareVersion(deviceId);
    const firmwareOptions = firmwares
      .map((firmware): ApplyOptionFirmware => {
        const order =
          currentFirmwareVersion === null
            ? null
            : compareFirmwareVersions(firmware.version, currentFirmwareVersion);
        return {
          id: firmware.id,
          version: firmware.version,
          isCurrent: order === 0,
          isDowngrade: order !== null && order < 0,
        };
      })
      .sort((a, b) => compareFirmwareVersions(b.version, a.version));

    return {
      deviceId,
      deviceInstalled: device.status === INSTALLED_DEVICE_STATUS,
      configs: options,
      currentFirmwareVersion,
      firmwares: firmwareOptions,
      openRequest: await this.findOpenRequest(deviceId, actor),
    };
  }

  /** คำขอที่ยังไม่จบของกล่อง — เงื่อนไขเดียวกับที่ create ใช้ปฏิเสธคำขอซ้ำ */
  private async findOpenRequest(
    deviceId: string,
    actor: ActingUser,
  ): Promise<ApplyOptionOpenRequest | null> {
    const open = await this.prisma.configApplyRequest.findFirst({
      where: { deviceId, status: { in: OPEN_CONFIG_APPLY_REQUEST_STATUSES } },
      orderBy: { requestedAt: 'desc' },
      select: {
        kind: true,
        status: true,
        taskId: true,
        config: { select: { name: true } },
        firmware: { select: { version: true } },
        task: { select: { assignedTo: true } },
      },
    });
    if (!open) return null;
    return {
      kind: open.kind,
      status: open.status,
      configName: open.config?.name ?? null,
      firmwareVersion: open.firmware?.version ?? null,
      taskId: open.task.assignedTo === actor.id ? open.taskId : null,
    };
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
      const override = row.override
        ? {
            id: row.override.id,
            reason: row.override.reason,
            fieldNames: Object.keys(
              (row.override.fields as Record<string, unknown>) ?? {},
            ),
          }
        : null;
      if (!row.config || !row.configId) {
        // คำขอ Firmware (docs/27 §5.2) — ไม่มีค่า field ให้แสดง
        views.push({ ...row, config: null, fieldNames: [], override });
        continue;
      }
      const { fields } = await mergeApprovedOverride(
        this.prisma,
        row.deviceId,
        row.configId,
        row.config.fields,
      );
      const { fields: _baseFields, ...config } = row.config;
      void _baseFields;
      views.push({ ...row, config, fieldNames: Object.keys(fields), override });
    }
    return views;
  }

  /**
   * `POST /config-apply-requests/{id}/approve` (§3.4, docs/27 §5.3) — SoD ครบทุก
   * ข้อ → ตรวจซ้ำแบบสดในทรานแซกชัน → `approved` (**ยังไม่ส่ง** — ช่างที่ถือ Task
   * กดส่งเองผ่าน `release()`) · snapshot เวอร์ชัน Config ที่อนุมัติ และตั้ง
   * `expiresAt` ใหม่เป็นเส้นตายของการกดส่ง
   */
  async approve(id: string, actor: ActingUser): Promise<ConfigApplyRequest> {
    const existing = await this.getPendingOrThrow(id);
    await this.assertDecider(existing, actor);

    const approved = await this.prisma.$transaction(async (tx) => {
      await this.assertStillApplicable(tx, existing);
      // Firmware เป็นไฟล์ก้อนเดียวต่อเวอร์ชัน ไม่มีเวอร์ชันย่อยให้ snapshot (D4)
      const approvedConfigVersion =
        existing.kind === 'config'
          ? await this.latestConfigVersion(tx, requireConfigId(existing))
          : null;
      const now = new Date();
      const result = await tx.configApplyRequest.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'approved',
          decidedBy: actor.id,
          decidedAt: now,
          approvedConfigVersion,
          expiresAt: new Date(
            now.getTime() + CONFIG_APPLY_APPROVAL_TTL_HOURS * HOUR_MS,
          ),
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
      // docs/30 มติ 1 — อนุมัติคำขอ = อนุมัติ Override ที่ผูกกัน (รอบเดียว)
      if (row.overrideId) {
        const linked = await tx.deviceConfigOverride.updateMany({
          where: { id: row.overrideId, status: 'pending' },
          data: { status: 'approved', decidedBy: actor.id, decidedAt: now },
        });
        if (linked.count === 0) {
          throw new ConflictException(
            'คำขอแก้ค่า (Override) ที่ผูกกับคำขอนี้ถูกตัดสินไปแล้ว — กรุณาโหลดข้อมูลใหม่',
          );
        }
      }
      await this.writeAudit(tx, 'config_apply_approve', actor, row);
      return row;
    });

    await this.notifyTaskHolder(approved, 'config_apply_approved', {
      expiresAt: approved.expiresAt.toISOString(),
    });
    return approved;
  }

  /**
   * `POST /config-apply-requests/{id}/release` (docs/27 §5.4) — ช่างที่**ถือ Task
   * อยู่ตอนนี้**กดส่งคำขอที่อนุมัติแล้วเข้ากล่อง · ตรวจทุกข้อซ้ำแบบสด แล้วค่อย
   * สร้าง Rollout เครื่องเดียว (เดิมทำตอนอนุมัติ) และเริ่มส่งหลัง commit
   *
   * - ไม่ใช่ผู้ถือ Task = 404 (IDOR เหมือน cancel)
   * - เลยเส้นตาย → ปิดเป็น `expired` แล้ว 409
   * - Config เปลี่ยนเวอร์ชัน/ใช้ไม่ได้แล้ว → ปิดเป็น `cancelled` แล้ว 409 (D4)
   * - กล่องออฟไลน์ (โหมด central) → 409 คำขอยัง `approved` ให้ลองใหม่ (D6)
   */
  async release(id: string, actor: ActingUser): Promise<ConfigApplyRequest> {
    const existing = await this.prisma.configApplyRequest.findUnique({
      where: { id },
    });
    const task = existing
      ? await this.prisma.task.findUnique({ where: { id: existing.taskId } })
      : null;
    if (!existing || !task || task.assignedTo !== actor.id) {
      throw new NotFoundException(`ไม่พบคำขอ id ${id}`);
    }
    if (existing.status !== 'approved') {
      throw new ConflictException(
        `ส่งเข้ากล่องได้เฉพาะคำขอที่อนุมัติแล้ว — สถานะปัจจุบัน: ${existing.status}`,
      );
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.expireOne(existing, new Date());
      throw new ConflictException(
        `คำอนุมัติหมดอายุแล้ว (ต้องกดส่งภายใน ${CONFIG_APPLY_APPROVAL_TTL_HOURS} ชั่วโมงหลังอนุมัติ) — ขอใหม่อีกครั้ง`,
      );
    }
    await this.closeIfPayloadChanged(existing);
    await this.assertDeviceOnline(existing.deviceId);

    const released = await this.prisma.$transaction(async (tx) => {
      await this.lockDevice(tx, existing.deviceId);
      await this.assertReleasable(tx, existing, actor);
      const result = await tx.configApplyRequest.updateMany({
        where: { id, status: 'approved' },
        data: {
          status: 'sending',
          releasedBy: actor.id,
          releasedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกส่งหรือปิดไปแล้ว (มีการกดส่ง/ยกเลิกอื่นเข้ามาพร้อมกัน) — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const payload: FieldApplyRolloutPayload =
        existing.kind === 'firmware'
          ? {
              kind: 'firmware',
              firmwareId: requireFirmwareId(existing),
              allowDowngrade: existing.isDowngrade,
            }
          : { kind: 'config', configId: requireConfigId(existing) };
      const { rolloutId } = await this.rolloutStarter.createFieldApplyRollout(
        tx,
        {
          ...payload,
          requestId: existing.id,
          deviceId: existing.deviceId,
          requestedBy: existing.requestedBy,
          approvedBy: existing.decidedBy as string,
        },
      );
      const row = await tx.configApplyRequest.update({
        where: { id },
        data: { rolloutId },
      });
      await this.writeAudit(tx, 'config_apply_release', actor, row);
      return row;
    });

    // ส่งจริงหลัง commit (§3.5 ข้อ 3) — ส่งไม่ได้ให้ฝั่ง campaign บันทึกเป็นผล
    // ล้มเหลวของ target แล้วส่งกลับมาทาง FIELD_APPLY_RESULT_EVENT ไม่ throw ที่นี่
    // เพราะการกดส่ง commit ไปแล้ว
    try {
      await this.rolloutStarter.startFieldApplyRollout(
        released.rolloutId as string,
        actor.id,
      );
    } catch (err) {
      this.logger.error(
        `เริ่มส่ง Rollout ของคำขอ ${released.id} ไม่สำเร็จ (rollout ${released.rolloutId}): ${(err as Error).message}`,
      );
    }
    return released;
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
      await this.closeLinkedOverride(
        tx,
        row,
        dto.rejectReason.trim(),
        actor.id,
      );
      await this.writeAudit(tx, 'config_apply_reject', actor, row);
      return row;
    });

    await this.notifyTaskHolder(rejected, 'config_apply_rejected', {
      rejectReason: rejected.rejectReason,
    });
    return rejected;
  }

  /** `POST /config-apply-requests/{id}/cancel` — ช่างที่ถือ Task อยู่ตอนนี้
   * (docs/27 D1 — เดิมผู้ขอ) ตอน `pending` หรือ `approved` · ไม่ใช่ผู้ถือ Task =
   * 404 (IDOR) */
  async cancel(id: string, actor: ActingUser): Promise<ConfigApplyRequest> {
    const existing = await this.prisma.configApplyRequest.findUnique({
      where: { id },
    });
    const task = existing
      ? await this.prisma.task.findUnique({ where: { id: existing.taskId } })
      : null;
    if (!existing || !task || task.assignedTo !== actor.id) {
      throw new NotFoundException(`ไม่พบคำขอ id ${id}`);
    }
    if (!CANCELLABLE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        `ยกเลิกได้เฉพาะคำขอที่รออนุมัติหรืออนุมัติแล้วแต่ยังไม่ส่ง — สถานะปัจจุบัน: ${existing.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.configApplyRequest.updateMany({
        where: { id, status: { in: CANCELLABLE_STATUSES } },
        data: {
          status: 'cancelled',
          resultDetail: 'ช่างยกเลิกคำขอเอง',
          completedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'คำขอนี้ถูกตัดสินหรือส่งไปแล้วระหว่างที่ยกเลิก — กรุณาโหลดข้อมูลใหม่',
        );
      }
      const row = await tx.configApplyRequest.findUniqueOrThrow({
        where: { id },
      });
      if (existing.status === 'pending') {
        await this.closeLinkedOverride(tx, row, 'ช่างยกเลิกคำขอ', null);
      }
      await this.writeAudit(tx, 'config_apply_cancel', actor, row);
      return row;
    });
  }

  /**
   * ปิดคำขอ `pending`/`approved` ที่เลย `expiresAt` (§3.9, docs/27 D2) เป็น
   * `expired` แล้วแจ้งช่างที่ถือ Task — เรียกจาก `ConfigApplyRequestExpiryJob` ·
   * claim ทีละแถวด้วย `updateMany` เงื่อนไขสถานะเดิม กันชนกับการตัดสิน/กดส่งที่
   * เข้ามาพร้อมกัน · คืนจำนวนที่ปิดได้
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.configApplyRequest.findMany({
      where: { status: { in: EXPIRABLE_STATUSES }, expiresAt: { lte: now } },
    });
    let expired = 0;
    for (const request of overdue) {
      if (await this.expireOne(request, now)) expired += 1;
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
      const type: NotificationType =
        event.outcome === 'succeeded'
          ? 'config_apply_succeeded'
          : 'config_apply_failed';
      const extra: Record<string, string | null> =
        event.outcome === 'succeeded'
          ? {}
          : { outcome: event.outcome, detail: event.detail };
      await this.notifyTaskHolder(request, type, extra);
      // Operation ที่อนุมัติรู้ผลด้วย (docs/27 §8) — การแสดงผลบน Web เป็นงาน A
      if (request.decidedBy) {
        await this.notifyUser(request.decidedBy, request, type, extra);
      }
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

  /** ปิดคำขอหนึ่งรายการเป็น `expired` (ถ้ายังอยู่สถานะเดิม) แล้วแจ้งช่าง ·
   * คืน `true` เมื่อปิดได้จริง */
  private async expireOne(
    request: ConfigApplyRequest,
    now: Date,
  ): Promise<boolean> {
    const wasApproved = request.status === 'approved';
    const resultDetail = wasApproved
      ? `อนุมัติแล้วแต่ไม่ได้กดส่งเข้ากล่องภายใน ${CONFIG_APPLY_APPROVAL_TTL_HOURS} ชั่วโมง คำอนุมัติหมดอายุ`
      : `ไม่มี Operation ตัดสินภายใน ${CONFIG_APPLY_REQUEST_TTL_HOURS} ชั่วโมง คำขอหมดอายุ`;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.configApplyRequest.updateMany({
        where: { id: request.id, status: request.status },
        data: { status: 'expired', resultDetail, completedAt: now },
      });
      if (result.count === 0) return false;
      if (!wasApproved) {
        await this.closeLinkedOverride(tx, request, resultDetail, null);
      }
      return true;
    });
    if (!claimed) return false;
    await this.notifyTaskHolder(request, 'config_apply_expired');
    return true;
  }

  /** `versionNumber` ล่าสุดของ Config (docs/27 D4) · 0 = ยังไม่มีแถว
   * ConfigVersion (Config จาก seed เก่า) */
  private async latestConfigVersion(
    db: Prisma.TransactionClient,
    configId: string,
  ): Promise<number> {
    const latest = await db.configVersion.aggregate({
      where: { configId },
      _max: { versionNumber: true },
    });
    return latest._max.versionNumber ?? 0;
  }

  /**
   * ของที่อนุมัติไว้ยังส่งได้เหมือนตอนอนุมัติไหม (docs/27 D4, §5.4 #4/#8) — ไม่ใช่
   * แล้วปิดคำขอเป็น `cancelled` พร้อมเหตุผล แล้ว 409 ให้ช่างขอใหม่ · ทำนอก
   * ทรานแซกชันหลักเพื่อให้การปิดคำขอ commit จริง (`assertReleasable` ตรวจซ้ำใน
   * ทรานแซกชันอีกรอบกัน race)
   *
   * - Config: ยังไม่ถูกลบ สถานะยังส่งได้ และเวอร์ชันล่าสุด = ที่อนุมัติ
   * - Firmware: ยัง QA อนุมัติ + อัปโหลดสำเร็จ และเวอร์ชันในกล่อง (Server กลาง)
   *   ยังทำให้ `isDowngrade` เป็นค่าเดิม — ไม่ใช่ = Operation อนุมัติภายใต้ข้อมูล
   *   ที่ไม่จริงแล้ว · ติดต่อ Server กลางไม่ได้ = 503 คำขอยัง `approved`
   */
  private async closeIfPayloadChanged(
    request: ConfigApplyRequest,
  ): Promise<void> {
    const reason =
      request.kind === 'firmware'
        ? await this.firmwareChangeReason(request)
        : await this.configChangeReason(request);
    if (!reason) return;
    const result = await this.prisma.configApplyRequest.updateMany({
      where: { id: request.id, status: 'approved' },
      data: {
        status: 'cancelled',
        resultDetail: `${reason} — ขอใหม่เพื่อให้ Operation อนุมัติค่าล่าสุด`,
        completedAt: new Date(),
      },
    });
    if (result.count > 0) {
      await this.notifyTaskHolder(request, 'config_apply_failed', {
        outcome: 'cancelled',
        detail: reason,
      });
    }
    throw new ConflictException(
      `${reason} — ระบบปิดคำขอนี้แล้ว ให้ขอใหม่เพื่อให้ Operation อนุมัติค่าล่าสุด`,
    );
  }

  private async configChangeReason(
    request: ConfigApplyRequest,
  ): Promise<string | null> {
    const configId = requireConfigId(request);
    const config = await this.prisma.config.findUnique({
      where: { id: configId },
    });
    const version = await this.latestConfigVersion(this.prisma, configId);
    if (!config || config.deletedAt !== null) {
      return 'Config ของคำขอนี้ถูกลบไปแล้ว';
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      return `Config เปลี่ยนสถานะเป็น ${config.status} หลังอนุมัติ ส่งไม่ได้แล้ว`;
    }
    if (version !== request.approvedConfigVersion) {
      return `Config มีเวอร์ชันใหม่ (v${version}) หลังอนุมัติ (v${request.approvedConfigVersion ?? '-'})`;
    }
    return null;
  }

  private async firmwareChangeReason(
    request: ConfigApplyRequest,
  ): Promise<string | null> {
    const firmware = await this.prisma.firmware.findUnique({
      where: { id: requireFirmwareId(request) },
    });
    if (
      !firmware ||
      firmware.uploadStatus !== SIMULATABLE_FIRMWARE_STATUS ||
      firmware.approvalStatus !== CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS
    ) {
      return 'Firmware ของคำขอนี้ใช้งานไม่ได้แล้ว (ถูกถอนอนุมัติคุณภาพหรือไฟล์ไม่พร้อม)';
    }
    const current = await this.readReportedFirmwareVersion(request.deviceId);
    if (current === null) return null;
    const order = compareFirmwareVersions(firmware.version, current);
    if (order === 0) {
      return `กล่องเป็น Firmware v${current} อยู่แล้ว`;
    }
    if (order < 0 !== request.isDowngrade) {
      return `เวอร์ชัน Firmware ในกล่องเปลี่ยนจาก v${request.fromFirmwareVersion ?? '-'} เป็น v${current} หลังอนุมัติ`;
    }
    return null;
  }

  /**
   * เวอร์ชัน Firmware ที่กล่องรายงานกับ Server กลาง (docs/27 §5.1) — โหมดอื่นนอกจาก
   * `central` ไม่มีแหล่งข้อมูล คืน `null` (ไม่ตรวจถอยเวอร์ชัน) · โหมด central
   * **fail closed**: ติดต่อไม่ได้ 503, Server กลางไม่รู้จักกล่อง/กล่องยังไม่เคย
   * รายงานเวอร์ชัน 409 (ไม่รู้ว่าถอยหรือไม่ จึงไม่ปล่อยผ่าน)
   */
  private async readReportedFirmwareVersion(
    deviceId: string,
  ): Promise<string | null> {
    if (this.applyMode !== 'central') return null;
    const { list, device } = await this.centralDevices.findDevice(deviceId);
    if (!list.reachable) {
      throw new ServiceUnavailableException(
        'ติดต่อ Server กลางไม่ได้ อ่านเวอร์ชัน Firmware ของกล่องไม่ได้ — ลองใหม่อีกครั้ง',
      );
    }
    if (!device) {
      throw new ConflictException(
        `Server กลางไม่รู้จักกล่อง ${deviceId} ส่ง Firmware ผ่าน Server กลางไม่ได้`,
      );
    }
    if (!device.reportedFirmwareVersion) {
      throw new ConflictException(
        'กล่องยังไม่เคยรายงานเวอร์ชัน Firmware กับ Server กลาง — เปิดกล่องให้ต่อ Server กลางก่อนแล้วลองใหม่',
      );
    }
    return device.reportedFirmwareVersion;
  }

  /** แบบไม่ throw สำหรับ `apply-options` (ข้อมูลเสริม) — อ่านไม่ได้ = `null` */
  private async tryReadReportedFirmwareVersion(
    deviceId: string,
  ): Promise<string | null> {
    try {
      return await this.readReportedFirmwareVersion(deviceId);
    } catch {
      return null;
    }
  }

  /**
   * กล่องต้องออนไลน์ตอนกดส่ง (docs/27 D6) — เช็คเฉพาะโหมด `central` (Server
   * กลางเป็นคนส่งเข้ากล่องจริง) · โหมด mock/real ไม่มีข้อมูลออนไลน์ให้เช็ค ·
   * ติดต่อ Server กลางไม่ได้ = 503 (ไม่รู้สถานะ ไม่ส่ง) · คำขอยัง `approved`
   */
  private async assertDeviceOnline(deviceId: string): Promise<void> {
    if (this.applyMode !== 'central') return;
    const { list, device } = await this.centralDevices.findDevice(deviceId);
    if (!list.reachable) {
      throw new ServiceUnavailableException(
        'ติดต่อ Server กลางไม่ได้ ตรวจสถานะกล่องไม่ได้ — ลองใหม่อีกครั้ง',
      );
    }
    if (!device?.online) {
      throw new ConflictException(
        'กล่องยังไม่ออนไลน์ — ตรวจไฟและสัญญาณของกล่องแล้วลองกดส่งใหม่',
      );
    }
  }

  /**
   * ตรวจซ้ำแบบสดตอนกดส่ง ในทรานแซกชันเดียวกับการเปลี่ยนสถานะ (docs/27 §5.4) —
   * mirror `assertStillApplicable()` ของตอนอนุมัติ แต่ผู้ถือ Task ต้องเป็นผู้กด
   * ส่ง (อาจไม่ใช่ผู้ขอ) และ Config ต้องยังเป็นเวอร์ชันที่อนุมัติ · ไม่ผ่าน = 409
   * คำขอยัง `approved`
   */
  private async assertReleasable(
    tx: Prisma.TransactionClient,
    request: ConfigApplyRequest,
    actor: ActingUser,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${request.taskId} FOR UPDATE`;
    const task = await tx.task.findUnique({ where: { id: request.taskId } });
    if (!task || task.assignedTo !== actor.id) {
      throw new NotFoundException(`ไม่พบคำขอ id ${request.id}`);
    }
    if (task.status !== 'in_progress') {
      throw new ConflictException(
        `งานต้องอยู่สถานะกำลังทำ (in_progress) ถึงจะส่งเข้ากล่องได้ — สถานะปัจจุบัน: ${task.status}`,
      );
    }
    if (
      task.deviceId !== request.deviceId ||
      (request.configAssignedBy !== null && task.configId !== request.configId)
    ) {
      throw new ConflictException(
        'Config หรือเครื่องของงานถูกเปลี่ยนแล้วตั้งแต่อนุมัติ — ยกเลิกคำขอแล้วขอใหม่',
      );
    }
    if (request.kind === 'firmware') {
      await this.assertFirmwareApplicable(
        tx,
        requireFirmwareId(request),
        request.deviceId,
        'approve',
      );
    } else {
      const configId = requireConfigId(request);
      await this.assertApplicable(tx, configId, request.deviceId, 'approve');
      const version = await this.latestConfigVersion(tx, configId);
      if (version !== request.approvedConfigVersion) {
        throw new ConflictException(
          'Config มีเวอร์ชันใหม่หลังอนุมัติ — ขอใหม่เพื่อให้ Operation อนุมัติค่าล่าสุด',
        );
      }
    }
    await this.assertNoOpenRolloutTarget(tx, request.deviceId);
  }

  /**
   * Separation of Duty ของผู้ตัดสิน (§3.4 ข้อ 1–5) — ทุกข้อ 403:
   * 1. ต้องเป็น role Operation
   * 2. ≠ ผู้ขอ
   * 3. ≠ ผู้ผูก Config เข้า Task (`configAssignedBy` ที่ snapshot ไว้) —
   *    **เฉพาะคำขอที่ใช้ Config ตัวที่ Operation ผูกไว้** (docs/28 §2.1, A ตอบ
   *    Q2 บน #382)
   * 4. `configAssignedBy` ว่าง = ช่างเลือก Config เอง (docs/28 D3) ข้ามข้อ 3 ·
   *    คำขอของ Config ที่ผูกไว้แต่ไม่รู้คนผูกถูกปฏิเสธตั้งแต่ตอนสร้าง (fail
   *    closed ที่ `create()`) จึงไม่มีทางมาถึงตรงนี้
   * 5. ≠ ผู้อนุมัติตัว Config (`Config.approvedBy`, มติ Q8) และถ้า
   *    `Config.approvedBy` ว่างก็ปฏิเสธ (fail closed — §3.4 ข้อ 5 ยังไม่ได้ตกลง
   *    กรณีนี้ จึงเลือกทางที่ไม่ผ่อน รอยืนยันกับ A)
   *
   * คำขอ Firmware (docs/27 §5.3) ใช้แค่ข้อ 1–2 — ไม่มีคนผูก/คนอนุมัติ Config ·
   * ผู้อนุมัติคุณภาพ Firmware เป็น QAEngineer ซึ่งเป็น Operation คนเดียวกันไม่ได้อยู่แล้ว
   */
  private async assertDecider(
    request: ConfigApplyRequest,
    actor: ActingUser,
  ): Promise<void> {
    if (actor.role !== OPERATION_ROLE) {
      throw new ForbiddenException(
        'ตัดสินคำขอส่งเข้ากล่องได้เฉพาะ Role Operation เท่านั้น',
      );
    }
    if (request.requestedBy === actor.id) {
      throw new ForbiddenException(
        'ผู้ขอส่งเข้ากล่องตัดสินคำขอของตัวเองไม่ได้ (Separation of Duty)',
      );
    }
    if (request.kind === 'firmware') return;
    if (request.configAssignedBy === actor.id) {
      throw new ForbiddenException(
        'ผู้ผูก Config เข้างานนี้อนุมัติการส่งเองไม่ได้ (Separation of Duty)',
      );
    }
    const config = await this.prisma.config.findUnique({
      where: { id: requireConfigId(request) },
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
   * จะไม่ครอบคนผูกล่าสุด ให้ช่างขอใหม่แทน (เข้มขึ้น ไม่ผ่อน) · เช็คเฉพาะคำขอที่ใช้
   * Config ที่ผูกไว้ — Config ที่ช่างเลือกเอง (docs/28) ไม่ผูกกับ `Task.configId`
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
      task.deviceId !== request.deviceId ||
      (request.configAssignedBy !== null &&
        (task.configId !== request.configId ||
          task.configAssignedBy !== request.configAssignedBy))
    ) {
      throw new ConflictException(
        'Config หรือเครื่องของงานถูกเปลี่ยนแล้วตั้งแต่ส่งคำขอ — ปฏิเสธคำขอแล้วให้ช่างขอใหม่',
      );
    }
    if (request.kind === 'firmware') {
      await this.assertFirmwareApplicable(
        tx,
        requireFirmwareId(request),
        request.deviceId,
        'approve',
      );
    } else {
      await this.assertApplicable(
        tx,
        requireConfigId(request),
        request.deviceId,
        'approve',
      );
    }
    await this.assertNoOpenRolloutTarget(tx, request.deviceId);
  }

  /**
   * Firmware ส่งเข้าเครื่องนี้ได้ไหม (docs/27 §5.1) — mirror เงื่อนไขของ
   * `DeviceService.assertFirmwareInstallable()` / `autoApplyFirmware()`: Firmware
   * ไม่พบ 404 · ยังไม่ `stored` หรือ QA ยังไม่ `approved` 409 · เครื่องไม่พบ 404 ·
   * ยังไม่ installed หรือรุ่นไม่อยู่ใน `deviceModelCompatibility` 409 · ตอนตรวจซ้ำ
   * (`approve`) ของที่หายไปเป็น 409 เพราะคำขอมีอยู่แล้ว
   */
  private async assertFirmwareApplicable(
    db: Prisma.TransactionClient,
    firmwareId: string,
    deviceId: string,
    phase: 'create' | 'approve',
  ): Promise<{ firmware: Firmware; device: Device }> {
    const firmware = await db.firmware.findUnique({
      where: { id: firmwareId },
    });
    if (!firmware) {
      if (phase === 'approve') {
        throw new ConflictException('Firmware ของคำขอนี้ไม่มีในระบบแล้ว');
      }
      throw new NotFoundException(`ไม่พบ Firmware id ${firmwareId}`);
    }
    if (
      firmware.uploadStatus !== SIMULATABLE_FIRMWARE_STATUS ||
      firmware.approvalStatus !== CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS
    ) {
      throw new ConflictException(
        `Firmware v${firmware.version} ยังส่งเข้ากล่องไม่ได้ (อัปโหลด: ${firmware.uploadStatus}, อนุมัติคุณภาพ: ${firmware.approvalStatus}) — ต้องอัปโหลดสำเร็จและ QA อนุมัติแล้ว`,
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
        `เครื่องสถานะปัจจุบัน (${device.status}) ยังส่ง Firmware ไม่ได้ — ต้องเป็น ${INSTALLED_DEVICE_STATUS} (ติดตั้งจริงแล้ว)`,
      );
    }
    if (!firmware.deviceModelCompatibility.includes(device.deviceModel)) {
      throw new ConflictException(
        `Firmware v${firmware.version} ไม่รองรับรุ่น ${device.deviceModel} (รองรับ: ${firmware.deviceModelCompatibility.join(', ')})`,
      );
    }
    return { firmware, device };
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
      ...(request.configId ? { configId: request.configId } : {}),
      ...(request.firmwareId ? { firmwareId: request.firmwareId } : {}),
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
          id: {
            notIn: [request.configAssignedBy, request.requestedBy].filter(
              (id): id is string => id !== null,
            ),
          },
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

  /** แจ้งช่างที่ถือ Task อยู่ตอนนี้ (docs/27 D1 — ถ้า Task ถูกโอน คนใหม่คือคนที่
   * ต้องกดส่ง) · หา Task ไม่เจอแจ้งผู้ขอแทน · never-throw */
  private async notifyTaskHolder(
    request: ConfigApplyRequest,
    type: NotificationType,
    extra: Record<string, string | null> = {},
  ): Promise<void> {
    let userId = request.requestedBy;
    try {
      const task = await this.prisma.task.findUnique({
        where: { id: request.taskId },
        select: { assignedTo: true },
      });
      if (task) userId = task.assignedTo;
    } catch (err) {
      this.logger.warn(
        `หาผู้ถือ Task ของคำขอ ${request.id} ไม่ได้ แจ้งผู้ขอแทน: ${(err as Error).message}`,
      );
    }
    await this.notifyUser(userId, request, type, extra);
  }

  /** never-throw */
  private async notifyUser(
    userId: string,
    request: ConfigApplyRequest,
    type: NotificationType,
    extra: Record<string, string | null> = {},
  ): Promise<void> {
    try {
      await this.notificationService.send({
        userId,
        type,
        payload: { ...this.notificationPayload(request), ...extra },
      });
    } catch (err) {
      this.logger.warn(
        `แจ้งเตือน ${type} ไม่สำเร็จ (คำขอ ${request.id}): ${(err as Error).message}`,
      );
    }
  }

  /** payload ตาม §3.6 — `taskId` ให้ Mobile เปิด Task Detail จาก notification ·
   * `kind` ให้ข้อความแจ้งเตือนบอกได้ว่าเป็น Config หรือ Firmware (docs/27 B2) */
  private notificationPayload(
    request: ConfigApplyRequest,
  ): Record<string, string> {
    return {
      requestId: request.id,
      taskId: request.taskId,
      deviceId: request.deviceId,
      kind: request.kind,
    };
  }
}

/** `configId` ของคำขอ Config — schema เป็น nullable ตั้งแต่ B2 แต่ service บังคับ
 * มีค่าเสมอเมื่อ `kind=config` · ไม่มี = ข้อมูลเสีย ไม่ปล่อยผ่าน (fail closed) */
function requireConfigId(request: ConfigApplyRequest): string {
  if (!request.configId) {
    throw new ConflictException(
      `คำขอ ${request.id} ไม่มี Config ที่จะส่ง (ข้อมูลไม่ครบ) — ยกเลิกแล้วขอใหม่`,
    );
  }
  return request.configId;
}

/** `firmwareId` ของคำขอ Firmware — เหตุผลเดียวกับ `requireConfigId()` */
function requireFirmwareId(request: ConfigApplyRequest): string {
  if (!request.firmwareId) {
    throw new ConflictException(
      `คำขอ ${request.id} ไม่มี Firmware ที่จะส่ง (ข้อมูลไม่ครบ) — ยกเลิกแล้วขอใหม่`,
    );
  }
  return request.firmwareId;
}
