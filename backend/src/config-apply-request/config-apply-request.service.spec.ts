import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigApplyRequest, Task } from '@prisma/client';
import { RolloutEvents } from '../campaign/rollout-events';
import { CentralDeviceService } from '../central-device/central-device.service';
import {
  CONFIG_APPLY_MODE,
  type ConfigApplyMode,
} from '../device/config-applier';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, TaskService } from '../task/task.service';
import {
  CONFIG_APPLY_APPROVAL_TTL_HOURS,
  CONFIG_APPLY_REQUEST_TTL_HOURS,
} from './config-apply-request-status';
import { ConfigApplyRequestService } from './config-apply-request.service';
import {
  FIELD_APPLY_RESULT_EVENT,
  FIELD_APPLY_ROLLOUT_STARTER,
  type FieldApplyRolloutStarter,
} from './field-apply-rollout';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const CONFIG_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const ROLLOUT_ID = '44444444-4444-4444-8444-444444444444';
const DEVICE_ID = 'BOX-0001';
/** ConfigVersion.versionNumber ล่าสุดของ Config ตัวอย่าง */
const CONFIG_VERSION = 3;

// คนในเรื่อง: ช่างผู้ขอ, Operation ผู้ผูก Config, Operation ผู้อนุมัติตัว Config,
// และ Operation คนที่ไม่เกี่ยวข้องเลย (คนเดียวที่ตัดสินคำขอได้)
const tech: ActingUser = { id: 'tech-1', role: 'ST' };
const assigner: ActingUser = { id: 'op-assigner', role: 'Operation' };
const configApprover: ActingUser = {
  id: 'op-config-approver',
  role: 'Operation',
};
const decider: ActingUser = { id: 'op-decider', role: 'Operation' };
const admin: ActingUser = { id: 'admin-1', role: 'Admin' };
const superAdmin: ActingUser = { id: 'superadmin-1', role: 'SuperAdmin' };

const task: Task = {
  id: TASK_ID,
  title: 'ติดตั้งกล่อง',
  description: null,
  assignedTo: tech.id,
  deviceId: DEVICE_ID,
  configId: CONFIG_ID,
  campaignId: null,
  configAssignedBy: assigner.id,
  configAssignedAt: new Date('2026-10-21T00:00:00.000Z'),
  status: 'in_progress',
  dueDate: null,
  source: 'operation',
  completedAt: null,
  autoClosed: false,
  createdAt: new Date('2026-10-20T00:00:00.000Z'),
  updatedAt: new Date('2026-10-20T00:00:00.000Z'),
};

const config = {
  id: CONFIG_ID,
  name: 'GT06N/TCP มาตรฐาน',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'approved',
  deletedAt: null,
  approvedBy: configApprover.id,
  fields: { APN: 'internet', SERVER_PORT: 909 },
};

const FIRMWARE_ID = '55555555-5555-4555-8555-555555555555';

/** Firmware ที่ส่งเข้ากล่องตัวอย่างได้ (stored + QA อนุมัติ + รองรับ GT06N) */
const firmware = {
  id: FIRMWARE_ID,
  version: '2.0.0',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored',
  approvalStatus: 'approved',
};

const device = {
  deviceId: DEVICE_ID,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'installed',
};

const pending: ConfigApplyRequest = {
  id: REQUEST_ID,
  overrideId: null,
  taskId: TASK_ID,
  deviceId: DEVICE_ID,
  kind: 'config',
  configId: CONFIG_ID,
  firmwareId: null,
  fromFirmwareVersion: null,
  isDowngrade: false,
  configAssignedBy: assigner.id,
  requestedBy: tech.id,
  requestedAt: new Date('2026-10-22T00:00:00.000Z'),
  expiresAt: new Date('2026-10-23T00:00:00.000Z'),
  note: null,
  status: 'pending',
  decidedBy: null,
  decidedAt: null,
  rejectReason: null,
  rolloutId: null,
  resultDetail: null,
  completedAt: null,
  approvedConfigVersion: null,
  releasedBy: null,
  releasedAt: null,
  createdAt: new Date('2026-10-22T00:00:00.000Z'),
  updatedAt: new Date('2026-10-22T00:00:00.000Z'),
};

/** อนุมัติแล้ว รอช่างกดส่ง (docs/27) — เส้นตายอยู่ในอนาคตเสมอ */
const approvedRequest: ConfigApplyRequest = {
  ...pending,
  status: 'approved',
  decidedBy: decider.id,
  decidedAt: new Date('2026-10-22T01:00:00.000Z'),
  approvedConfigVersion: CONFIG_VERSION,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

describe('ConfigApplyRequestService', () => {
  let service: ConfigApplyRequestService;
  let prisma: Record<string, Record<string, jest.Mock> | jest.Mock>;
  let requests: Record<string, jest.Mock>;
  let rolloutTargets: { findFirst: jest.Mock };
  let auditLog: { create: jest.Mock };
  let users: { findMany: jest.Mock };
  let notification: { send: jest.Mock };
  let taskService: { findOne: jest.Mock };
  let configVersions: { aggregate: jest.Mock };
  let central: { findDevice: jest.Mock };
  let createRollout: jest.Mock;
  let startRollout: jest.Mock;
  let starter: FieldApplyRolloutStarter;
  let events: RolloutEvents;

  async function build(
    rolloutStarter: FieldApplyRolloutStarter,
    applyMode: ConfigApplyMode = 'mock',
  ): Promise<ConfigApplyRequestService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigApplyRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        { provide: TaskService, useValue: taskService },
        { provide: FIELD_APPLY_ROLLOUT_STARTER, useValue: rolloutStarter },
        { provide: RolloutEvents, useValue: events },
        { provide: CentralDeviceService, useValue: central },
        { provide: CONFIG_APPLY_MODE, useValue: applyMode },
      ],
    }).compile();
    const built = module.get(ConfigApplyRequestService);
    built.onModuleInit();
    return built;
  }

  beforeEach(async () => {
    requests = {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(pending),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      // แถวที่ DB คืน — คำขอ Firmware ไม่ส่ง configId/configAssignedBy (DB เป็น null)
      create: jest.fn((args: { data: { kind?: string } }) =>
        Promise.resolve({
          ...pending,
          ...(args.data.kind === 'firmware'
            ? { configId: null, configAssignedBy: null }
            : {}),
          ...args.data,
          id: REQUEST_ID,
        }),
      ),
      update: jest.fn((args: { data: object }) =>
        Promise.resolve({ ...pending, status: 'sending', ...args.data }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    rolloutTargets = { findFirst: jest.fn().mockResolvedValue(null) };
    configVersions = {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _max: { versionNumber: CONFIG_VERSION } }),
    };
    central = {
      findDevice: jest.fn().mockResolvedValue({
        list: { reachable: true },
        device: { deviceId: DEVICE_ID, online: true },
      }),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    users = {
      findMany: jest.fn().mockResolvedValue([{ id: decider.id }]),
    };
    prisma = {
      task: { findUnique: jest.fn().mockResolvedValue(task) },
      config: {
        findUnique: jest.fn((args: { select?: object }) =>
          Promise.resolve(
            args.select ? { approvedBy: config.approvedBy } : config,
          ),
        ),
      },
      device: { findUnique: jest.fn().mockResolvedValue(device) },
      firmware: {
        findUnique: jest.fn().mockResolvedValue(firmware),
        findMany: jest.fn().mockResolvedValue([]),
      },
      configApplyRequest: requests,
      configVersion: configVersions,
      campaignRolloutTarget: rolloutTargets,
      deviceConfigOverride: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog,
      user: users,
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    notification = { send: jest.fn().mockResolvedValue(undefined) };
    taskService = { findOne: jest.fn().mockResolvedValue(task) };
    createRollout = jest.fn().mockResolvedValue({ rolloutId: ROLLOUT_ID });
    startRollout = jest.fn().mockResolvedValue(undefined);
    starter = {
      createFieldApplyRollout: createRollout,
      startFieldApplyRollout: startRollout,
    };
    events = new RolloutEvents();
    service = await build(starter);
  });

  /** ให้ config.findUnique (ตอนเช็ค SoD ที่ select approvedBy) คืนค่าที่กำหนด */
  function configApprovedBy(approvedBy: string | null): void {
    (prisma.config as Record<string, jest.Mock>).findUnique.mockImplementation(
      (args: { select?: object }) =>
        Promise.resolve(args.select ? { approvedBy } : config),
    );
  }

  describe('create (ช่างขอส่ง — §3.3)', () => {
    it('สร้างคำขอจากข้อมูลของ Task เอง: snapshot ผู้ผูก Config, หมดอายุใน 24 ชม., ลง AuditLog', async () => {
      const result = await service.create(
        TASK_ID,
        { note: ' ติดตั้งเสร็จแล้ว ' },
        tech,
      );

      const data = (
        requests.create.mock.calls[0] as [{ data: ConfigApplyRequest }]
      )[0].data;
      expect(data).toMatchObject({
        taskId: TASK_ID,
        deviceId: DEVICE_ID,
        configId: CONFIG_ID,
        configAssignedBy: assigner.id,
        requestedBy: tech.id,
        note: 'ติดตั้งเสร็จแล้ว',
      });
      expect(data.expiresAt.getTime() - data.requestedAt.getTime()).toBe(
        CONFIG_APPLY_REQUEST_TTL_HOURS * 60 * 60 * 1000,
      );
      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: tech.id,
          auditModule: 'config-apply-request',
          action: 'config_apply_request',
          metadata: { deviceId: DEVICE_ID, configId: CONFIG_ID },
        }) as unknown,
      });
      expect(result.status).toBe('pending');
    });

    describe('direct: true — ส่ง Config ที่อนุมัติแล้วโดยไม่แก้ค่า (ไม่ต้องรอ Operation)', () => {
      it('สร้างเป็น approved ทันที: snapshot เวอร์ชัน Config, เส้นตายแบบอนุมัติแล้ว, ไม่มีผู้อนุมัติ, AuditLog', async () => {
        const result = await service.create(TASK_ID, { direct: true }, tech);

        const data = (
          requests.create.mock.calls[0] as [{ data: ConfigApplyRequest }]
        )[0].data;
        expect(data).toMatchObject({
          configId: CONFIG_ID,
          status: 'approved',
          decidedBy: null,
          approvedConfigVersion: CONFIG_VERSION,
        });
        expect(data.decidedAt).toEqual(data.requestedAt);
        expect(data.expiresAt.getTime() - data.requestedAt.getTime()).toBe(
          CONFIG_APPLY_APPROVAL_TTL_HOURS * 60 * 60 * 1000,
        );
        expect(auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            userId: tech.id,
            action: 'config_apply_direct',
          }) as unknown,
        });
        expect(result.status).toBe('approved');
      });

      it('ไม่แจ้ง Operation (ไม่มีอะไรให้อนุมัติ)', async () => {
        await service.create(TASK_ID, { direct: true }, tech);

        expect(notification.send).not.toHaveBeenCalled();
      });

      it('Firmware ส่งตรงไม่ได้ — ยังต้องรออนุมัติ: 400', async () => {
        await expect(
          service.create(
            TASK_ID,
            { kind: 'firmware', firmwareId: FIRMWARE_ID, direct: true },
            tech,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(requests.create).not.toHaveBeenCalled();
      });
    });

    it('ล็อกระดับเครื่องก่อนเช็คคำขอซ้ำ (กันสองงานของเครื่องเดียวกันขอพร้อมกัน)', async () => {
      await service.create(TASK_ID, {}, tech);

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('แจ้ง Operation ทุกคนยกเว้นผู้ผูก Config และผู้ขอ (§3.6)', async () => {
      await service.create(TASK_ID, {}, tech);

      expect(users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: { code: 'Operation' },
            id: { notIn: [assigner.id, tech.id] },
          }) as unknown,
        }),
      );
      expect(notification.send).toHaveBeenCalledWith({
        userId: decider.id,
        type: 'config_apply_pending',
        payload: {
          requestId: REQUEST_ID,
          kind: 'config',
          taskId: TASK_ID,
          deviceId: DEVICE_ID,
        },
      });
    });

    it('notification ล้มเหลว: คำขอยังสร้างสำเร็จ (never-throw)', async () => {
      notification.send.mockRejectedValue(new Error('fcm down'));

      await expect(service.create(TASK_ID, {}, tech)).resolves.toBeDefined();
    });

    it('ไม่ใช่ผู้ถูก assign: 404 (IDOR) ไม่สร้าง', async () => {
      await expect(
        service.create(TASK_ID, {}, { id: 'tech-2', role: 'OT' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('งานไม่ได้อยู่ in_progress: 409', async () => {
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        status: 'pending',
      });

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('งานไม่มี configId และช่างไม่ได้เลือก Config: 400', async () => {
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        configId: null,
        configAssignedBy: null,
      });

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('งานไม่มีเครื่อง: 409', async () => {
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        deviceId: null,
      });

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    describe('ช่างเลือก Config เอง (docs/28 §5.3)', () => {
      const OTHER_CONFIG_ID = '77777777-7777-7777-7777-777777777777';

      it('Config ตัวอื่นจาก body: ใช้ configId นั้น ไม่ snapshot ผู้ผูก และแจ้ง Operation ทุกคนยกเว้นผู้ขอ', async () => {
        await service.create(TASK_ID, { configId: OTHER_CONFIG_ID }, tech);

        const data = (
          requests.create.mock.calls[0] as [{ data: ConfigApplyRequest }]
        )[0].data;
        expect(data).toMatchObject({
          configId: OTHER_CONFIG_ID,
          configAssignedBy: null,
        });
        expect(
          (prisma.config as Record<string, jest.Mock>).findUnique,
        ).toHaveBeenCalledWith({ where: { id: OTHER_CONFIG_ID } });
        expect(users.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: { notIn: [tech.id] },
            }) as unknown,
          }),
        );
      });

      it('งานที่ช่างเริ่มเอง (ไม่มี Config ผูก) ขอได้เมื่อเลือก Config', async () => {
        (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue(
          {
            ...task,
            configId: null,
            configAssignedBy: null,
            source: 'technician',
          },
        );

        await service.create(TASK_ID, { configId: OTHER_CONFIG_ID }, tech);

        expect(requests.create).toHaveBeenCalled();
      });

      it('เลือกตัวเดียวกับที่ Operation ผูกไว้: snapshot ผู้ผูก (SoD ข้อ 3 ยังใช้)', async () => {
        await service.create(TASK_ID, { configId: CONFIG_ID }, tech);

        const data = (
          requests.create.mock.calls[0] as [{ data: ConfigApplyRequest }]
        )[0].data;
        expect(data.configAssignedBy).toBe(assigner.id);
      });

      it('งานเก่าไม่รู้ผู้ผูก แต่ช่างเลือก Config ตัวอื่น: ขอได้ (fail closed เฉพาะตัวที่ผูก)', async () => {
        (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue(
          { ...task, configAssignedBy: null },
        );

        await service.create(TASK_ID, { configId: OTHER_CONFIG_ID }, tech);

        expect(requests.create).toHaveBeenCalled();
      });

      it('Config ที่เลือกยังไม่อนุมัติ (draft): 409 ไม่สร้างคำขอ', async () => {
        (
          prisma.config as Record<string, jest.Mock>
        ).findUnique.mockResolvedValue({
          ...config,
          id: OTHER_CONFIG_ID,
          status: 'draft',
        });

        await expect(
          service.create(TASK_ID, { configId: OTHER_CONFIG_ID }, tech),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.create).not.toHaveBeenCalled();
      });

      it('Config ที่เลือกรุ่นไม่ตรงกับกล่อง: 409', async () => {
        (
          prisma.config as Record<string, jest.Mock>
        ).findUnique.mockResolvedValue({
          ...config,
          id: OTHER_CONFIG_ID,
          deviceModel: 'TK103',
        });

        await expect(
          service.create(TASK_ID, { configId: OTHER_CONFIG_ID }, tech),
        ).rejects.toThrow('ไม่ตรงกับเครื่อง');
      });
    });

    it('fail closed: งานเก่าไม่มี configAssignedBy -> 409 ให้ Operation ผูก Config ใหม่ ไม่สร้างคำขอ', async () => {
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        configAssignedBy: null,
      });

      await expect(service.create(TASK_ID, {}, tech)).rejects.toThrow(
        'งานนี้ยังไม่มีข้อมูลผู้ผูก Config ให้ Operation ผูก Config ใหม่ก่อน',
      );
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('Config ถูกลบแล้ว: 404', async () => {
      (prisma.config as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        {
          ...config,
          deletedAt: new Date(),
        },
      );

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('Config ยังไม่ approved/synced: 409', async () => {
      (prisma.config as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        {
          ...config,
          status: 'testing',
        },
      );

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('เครื่องยังไม่ installed: 409', async () => {
      (prisma.device as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        {
          ...device,
          status: 'in_stock',
        },
      );

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('รุ่น/protocol ไม่ตรงกับ Config: 409', async () => {
      (prisma.device as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        {
          ...device,
          deviceModel: 'GT06L',
        },
      );

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('เครื่องมีคำขอที่ยังเปิดอยู่: 409', async () => {
      requests.findFirst.mockResolvedValue({ ...pending, status: 'sending' });

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(requests.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: DEVICE_ID,
          status: { in: ['pending', 'approved', 'sending'] },
        },
      });
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('เครื่องเป็น target pending ของ Rollout ที่ active/paused: 409 (กันชนกับ Campaign)', async () => {
      rolloutTargets.findFirst.mockResolvedValue({ id: 'target-1' });

      await expect(service.create(TASK_ID, {}, tech)).rejects.toThrow(
        'มี Campaign กำลังส่ง Config ให้เครื่องนี้อยู่',
      );
      expect(requests.create).not.toHaveBeenCalled();
    });
  });

  describe('Separation of Duty ตอนตัดสิน (§3.4)', () => {
    type Decide = (actor: ActingUser) => Promise<unknown>;
    const decisions: [string, (s: ConfigApplyRequestService) => Decide][] = [
      ['approve', (s) => (actor) => s.approve(REQUEST_ID, actor)],
      [
        'reject',
        (s) => (actor) =>
          s.reject(REQUEST_ID, { rejectReason: 'ค่า APN ผิด' }, actor),
      ],
    ];

    describe.each(decisions)('%s', (_name, decide) => {
      it('ข้อ 1: ไม่ใช่ Operation (เช่น Admin) -> 403', async () => {
        await expect(decide(service)(admin)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('SuperAdmin ข้าม SoD ได้ทันที ไม่เช็คข้อ 1-5 เลย (มติ 2026-10-30)', async () => {
        // ใช้ค่าดีฟอลต์ของ pending/task ไม่แก้อะไร (configAssignedBy =
        // assigner.id, ไม่ใช่ superAdmin) — ยืนยันว่า assertDecider() คืนทันที
        // ตั้งแต่เช็ค role ไม่ต้องให้ actor.id ตรงกับใครเลยในคำขอก็ผ่านได้
        requests.findUniqueOrThrow.mockResolvedValue({
          ...pending,
          status: 'approved',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });

        await decide(service)(superAdmin);

        expect(requests.updateMany).toHaveBeenCalled();
      });

      it('ข้อ 2: ผู้ตัดสินเป็นผู้ขอเอง -> 403', async () => {
        requests.findUnique.mockResolvedValue({
          ...pending,
          requestedBy: decider.id,
        });

        await expect(decide(service)(decider)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('ข้อ 3: ผู้ผูก Config เข้างาน (Task.configAssignedBy) ตัดสินเอง -> 403', async () => {
        await expect(decide(service)(assigner)).rejects.toThrow(
          'ผู้ผูก Config เข้างานนี้อนุมัติการส่งเองไม่ได้ (Separation of Duty)',
        );
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('ข้อ 4 (docs/28): ช่างเลือก Config เอง (configAssignedBy null) -> ข้ามข้อ 3 Operation ที่ผูก Config ตัวอื่นไว้กับงานตัดสินได้', async () => {
        const chosen = { ...pending, configAssignedBy: null };
        requests.findUnique.mockResolvedValue(chosen);
        requests.findUniqueOrThrow.mockResolvedValue({
          ...chosen,
          status: 'approved',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });

        await decide(service)(assigner);

        expect(requests.updateMany).toHaveBeenCalled();
      });

      it('ข้อ 4 (docs/28): ช่างเลือก Config เอง แต่ผู้ขอตัดสินเอง -> ยัง 403 (ข้อ 2 ไม่ผ่อน)', async () => {
        requests.findUnique.mockResolvedValue({
          ...pending,
          configAssignedBy: null,
          requestedBy: decider.id,
        });

        await expect(decide(service)(decider)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('ข้อ 5 (Q8): ผู้อนุมัติตัว Config (Config.approvedBy) ตัดสินเอง -> 403', async () => {
        await expect(decide(service)(configApprover)).rejects.toThrow(
          'ผู้อนุมัติตัว Config นี้อนุมัติการส่งเข้าเครื่องเองไม่ได้ (Separation of Duty)',
        );
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('ข้อ 5: Config.approvedBy ว่าง -> 403 (fail closed)', async () => {
        configApprovedBy(null);

        await expect(decide(service)(decider)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('คำขอไม่ใช่ pending แล้ว -> 409', async () => {
        requests.findUnique.mockResolvedValue({
          ...pending,
          status: 'rejected',
        });

        await expect(decide(service)(decider)).rejects.toBeInstanceOf(
          ConflictException,
        );
      });

      it('ไม่พบคำขอ -> 404', async () => {
        requests.findUnique.mockResolvedValue(null);

        await expect(decide(service)(decider)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });

      it('race: มีคนตัดสินไปก่อน (updateMany count 0) -> 409', async () => {
        requests.updateMany.mockResolvedValue({ count: 0 });

        await expect(decide(service)(decider)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(createRollout).not.toHaveBeenCalled();
      });
    });
  });

  describe('approve (docs/27 §5.3 — อนุมัติแล้วยังไม่ส่ง)', () => {
    it('ผ่านทุกข้อ: approved + decidedBy + snapshot เวอร์ชัน Config + เส้นตายกดส่ง 24 ชม. · ไม่สร้าง Rollout · แจ้งช่าง config_apply_approved', async () => {
      requests.findUniqueOrThrow.mockResolvedValue(approvedRequest);

      const result = await service.approve(REQUEST_ID, decider);

      const call = requests.updateMany.mock.calls[0] as [
        {
          where: object;
          data: { decidedAt: Date; expiresAt: Date } & Record<string, unknown>;
        },
      ];
      expect(call[0].where).toEqual({ id: REQUEST_ID, status: 'pending' });
      expect(call[0].data).toMatchObject({
        status: 'approved',
        decidedBy: decider.id,
        approvedConfigVersion: CONFIG_VERSION,
      });
      expect(
        call[0].data.expiresAt.getTime() - call[0].data.decidedAt.getTime(),
      ).toBe(CONFIG_APPLY_APPROVAL_TTL_HOURS * 60 * 60 * 1000);
      expect(createRollout).not.toHaveBeenCalled();
      expect(startRollout).not.toHaveBeenCalled();
      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'config_apply_approve',
          userId: decider.id,
        }) as unknown,
      });
      expect(notification.send).toHaveBeenCalledWith({
        userId: tech.id,
        type: 'config_apply_approved',
        payload: {
          requestId: REQUEST_ID,
          kind: 'config',
          taskId: TASK_ID,
          deviceId: DEVICE_ID,
          expiresAt: approvedRequest.expiresAt.toISOString(),
        },
      });
      expect(result.status).toBe('approved');
    });

    it('Config ที่ยังไม่มีแถว ConfigVersion (seed เก่า): snapshot เป็น 0', async () => {
      configVersions.aggregate.mockResolvedValue({
        _max: { versionNumber: null },
      });
      requests.findUniqueOrThrow.mockResolvedValue(approvedRequest);

      await service.approve(REQUEST_ID, decider);

      expect(requests.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvedConfigVersion: 0,
          }) as unknown,
        }),
      );
    });

    describe('ตรวจซ้ำแบบสด (§3.5 ข้อ 1) — ไม่ผ่าน = 409 ไม่เปลี่ยนสถานะ', () => {
      const cases: [string, Partial<Task>][] = [
        ['งานไม่ได้ in_progress แล้ว', { status: 'cancelled' }],
        ['งานถูกย้ายไปคนอื่น', { assignedTo: 'tech-2' }],
        ['Config ของงานถูกเปลี่ยน', { configId: 'other-config' }],
        ['เครื่องของงานถูกเปลี่ยน', { deviceId: 'BOX-0002' }],
        [
          'Operation คนอื่นผูก Config ใหม่ระหว่างรอ (configAssignedBy ไม่ตรง snapshot)',
          { configAssignedBy: 'op-other' },
        ],
      ];

      it.each(cases)('%s', async (_name, change) => {
        (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue(
          {
            ...task,
            ...change,
          },
        );

        await expect(
          service.approve(REQUEST_ID, decider),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('Config ถูกถอนเป็น testing ระหว่างรอ', async () => {
        (
          prisma.config as Record<string, jest.Mock>
        ).findUnique.mockImplementation((args: { select?: object }) =>
          Promise.resolve(
            args.select
              ? { approvedBy: config.approvedBy }
              : { ...config, status: 'testing' },
          ),
        );

        await expect(
          service.approve(REQUEST_ID, decider),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.updateMany).not.toHaveBeenCalled();
      });

      it('มี Campaign เริ่มส่งให้เครื่องนี้ระหว่างรอ', async () => {
        rolloutTargets.findFirst.mockResolvedValue({ id: 'target-1' });

        await expect(
          service.approve(REQUEST_ID, decider),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.updateMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('release (docs/27 §5.4 — ช่างกดส่งเข้ากล่อง)', () => {
    beforeEach(() => {
      requests.findUnique.mockResolvedValue(approvedRequest);
    });

    it('ผ่านทุกข้อ: sending + releasedBy, สร้าง Rollout (approvedBy = ผู้อนุมัติ) แล้วผูก rolloutId, ลง audit, เริ่มส่งหลัง commit', async () => {
      const result = await service.release(REQUEST_ID, tech);

      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'approved' },
        data: expect.objectContaining({
          status: 'sending',
          releasedBy: tech.id,
        }) as unknown,
      });
      expect(createRollout).toHaveBeenCalledWith(prisma, {
        requestId: REQUEST_ID,
        kind: 'config',
        deviceId: DEVICE_ID,
        configId: CONFIG_ID,
        requestedBy: tech.id,
        approvedBy: decider.id,
      });
      expect(requests.update).toHaveBeenCalledWith({
        where: { id: REQUEST_ID },
        data: { rolloutId: ROLLOUT_ID },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'config_apply_release',
          userId: tech.id,
        }) as unknown,
      });
      expect(startRollout).toHaveBeenCalledWith(ROLLOUT_ID, tech.id);
      expect(result.rolloutId).toBe(ROLLOUT_ID);
    });

    it('Config ที่ช่างเลือกเอง (docs/28): งานไม่มี Config ผูกก็กดส่งได้', async () => {
      requests.findUnique.mockResolvedValue({
        ...approvedRequest,
        configAssignedBy: null,
      });
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        configId: null,
        configAssignedBy: null,
        source: 'technician',
      });

      await expect(service.release(REQUEST_ID, tech)).resolves.toMatchObject({
        rolloutId: ROLLOUT_ID,
      });
    });

    it('Config ที่ผูกไว้ถูก Operation เปลี่ยนหลังอนุมัติ: 409 ไม่สร้าง Rollout', async () => {
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        configId: '77777777-7777-7777-7777-777777777777',
      });

      await expect(service.release(REQUEST_ID, tech)).rejects.toThrow(
        'Config หรือเครื่องของงานถูกเปลี่ยนแล้วตั้งแต่อนุมัติ',
      );
      expect(createRollout).not.toHaveBeenCalled();
    });

    it('Task ถูกโอน: คนที่ถือ Task ตอนนี้กดส่งได้ ผู้ขอเดิมได้ 404 (D1)', async () => {
      const newHolder: ActingUser = { id: 'tech-2', role: 'OT' };
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        assignedTo: newHolder.id,
      });

      await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.release(REQUEST_ID, newHolder),
      ).resolves.toMatchObject({ rolloutId: ROLLOUT_ID });
    });

    it('ยังไม่ได้อนุมัติ (pending): 409 ไม่สร้าง Rollout', async () => {
      requests.findUnique.mockResolvedValue(pending);

      await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(createRollout).not.toHaveBeenCalled();
    });

    it('เลยเส้นตาย 24 ชม.: ปิดเป็น expired + แจ้งช่าง แล้ว 409', async () => {
      requests.findUnique.mockResolvedValue({
        ...approvedRequest,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'approved' },
        data: expect.objectContaining({ status: 'expired' }) as unknown,
      });
      expect(notification.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'config_apply_expired' }),
      );
      expect(createRollout).not.toHaveBeenCalled();
    });

    it('Config มีเวอร์ชันใหม่หลังอนุมัติ: ปิดเป็น cancelled พร้อมเหตุผล แล้ว 409 (D4)', async () => {
      configVersions.aggregate.mockResolvedValue({
        _max: { versionNumber: CONFIG_VERSION + 1 },
      });

      await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'approved' },
        data: expect.objectContaining({ status: 'cancelled' }) as unknown,
      });
      expect(notification.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'config_apply_failed' }),
      );
      expect(createRollout).not.toHaveBeenCalled();
    });

    it('งานไม่ได้ in_progress แล้ว: 409 คำขอยัง approved', async () => {
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        status: 'completed',
      });

      await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(requests.updateMany).not.toHaveBeenCalled();
    });

    it('race: มีคนกดส่ง/ยกเลิกไปก่อน (updateMany count 0) -> 409 ไม่สร้าง Rollout', async () => {
      requests.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(createRollout).not.toHaveBeenCalled();
    });

    it('เริ่มส่งไม่สำเร็จหลัง commit: ยังคืนผลกดส่ง (ฝั่ง campaign รายงานผลล้มเหลวเอง)', async () => {
      startRollout.mockRejectedValue(new Error('central down'));

      await expect(service.release(REQUEST_ID, tech)).resolves.toMatchObject({
        rolloutId: ROLLOUT_ID,
      });
    });

    it('สร้าง Rollout ไม่สำเร็จ (ในทรานแซกชัน): error ส่งต่อ ไม่ผูก rolloutId ไม่ลง audit ไม่เริ่มส่ง', async () => {
      const failure = new Error('สร้าง Rollout ไม่สำเร็จ');
      createRollout.mockRejectedValue(failure);

      await expect(service.release(REQUEST_ID, tech)).rejects.toBe(failure);
      expect(requests.update).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
      expect(startRollout).not.toHaveBeenCalled();
    });

    describe('กล่องออนไลน์ (D6)', () => {
      it('โหมด mock: ไม่ถาม Server กลาง', async () => {
        await service.release(REQUEST_ID, tech);

        expect(central.findDevice).not.toHaveBeenCalled();
      });

      it('โหมด central + กล่องออนไลน์: ส่งได้', async () => {
        service = await build(starter, 'central');
        requests.findUnique.mockResolvedValue(approvedRequest);

        await expect(service.release(REQUEST_ID, tech)).resolves.toMatchObject({
          rolloutId: ROLLOUT_ID,
        });
        expect(central.findDevice).toHaveBeenCalledWith(DEVICE_ID);
      });

      it('โหมด central + กล่องออฟไลน์: 409 คำขอยัง approved ไม่สร้าง Rollout', async () => {
        service = await build(starter, 'central');
        requests.findUnique.mockResolvedValue(approvedRequest);
        central.findDevice.mockResolvedValue({
          list: { reachable: true },
          device: { deviceId: DEVICE_ID, online: false },
        });

        await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(requests.updateMany).not.toHaveBeenCalled();
        expect(createRollout).not.toHaveBeenCalled();
      });

      it('โหมด central + Server กลางติดต่อไม่ได้: 503 ไม่ส่ง', async () => {
        service = await build(starter, 'central');
        requests.findUnique.mockResolvedValue(approvedRequest);
        central.findDevice.mockResolvedValue({
          list: { reachable: false },
          device: null,
        });

        await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        expect(createRollout).not.toHaveBeenCalled();
      });
    });
  });

  describe('reject', () => {
    it('rejected + เหตุผล + แจ้งช่างที่ถือ Task config_apply_rejected', async () => {
      requests.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        status: 'rejected',
        rejectReason: 'ค่า APN ผิด',
      });

      await service.reject(
        REQUEST_ID,
        { rejectReason: ' ค่า APN ผิด ' },
        decider,
      );

      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'pending' },
        data: expect.objectContaining({
          status: 'rejected',
          decidedBy: decider.id,
          rejectReason: 'ค่า APN ผิด',
        }) as unknown,
      });
      expect(notification.send).toHaveBeenCalledWith({
        userId: tech.id,
        type: 'config_apply_rejected',
        payload: {
          requestId: REQUEST_ID,
          kind: 'config',
          taskId: TASK_ID,
          deviceId: DEVICE_ID,
          rejectReason: 'ค่า APN ผิด',
        },
      });
      expect(createRollout).not.toHaveBeenCalled();
    });
  });

  describe('cancel (ช่างที่ถือ Task — docs/27 §5.5)', () => {
    it.each([
      ['pending', pending],
      ['approved', approvedRequest],
    ])('ยกเลิกคำขอ %s ได้', async (_name, request) => {
      requests.findUnique.mockResolvedValue(request);
      requests.findUniqueOrThrow.mockResolvedValue({
        ...request,
        status: 'cancelled',
      });

      const result = await service.cancel(REQUEST_ID, tech);

      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: { in: ['pending', 'approved'] } },
        data: expect.objectContaining({ status: 'cancelled' }) as unknown,
      });
      expect(result.status).toBe('cancelled');
      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'config_apply_cancel',
        }) as unknown,
      });
    });

    it('ไม่ใช่ผู้ถือ Task: 404 (IDOR)', async () => {
      await expect(
        service.cancel(REQUEST_ID, { id: 'tech-2', role: 'OT' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(requests.updateMany).not.toHaveBeenCalled();
    });

    it('คำขอ sending แล้ว: 409', async () => {
      requests.findUnique.mockResolvedValue({ ...pending, status: 'sending' });

      await expect(service.cancel(REQUEST_ID, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('expireOverdue (Q9 + docs/27 D2 หมดอายุอัตโนมัติ)', () => {
    it('ปิดคำขอ pending ที่เลยเวลาเป็น expired และแจ้งช่าง', async () => {
      const now = new Date('2026-10-23T00:05:00.000Z');
      requests.findMany.mockResolvedValue([pending]);

      const expired = await service.expireOverdue(now);

      expect(requests.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'approved'] },
          expiresAt: { lte: now },
        },
      });
      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'pending' },
        data: expect.objectContaining({
          status: 'expired',
          completedAt: now,
        }) as unknown,
      });
      expect(notification.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: tech.id,
          type: 'config_apply_expired',
        }),
      );
      expect(expired).toBe(1);
    });

    it('คำขอ approved ที่ไม่ได้กดส่งทันเวลา: expired พร้อมเหตุผลว่าไม่ได้กดส่ง', async () => {
      requests.findMany.mockResolvedValue([approvedRequest]);

      await expect(service.expireOverdue()).resolves.toBe(1);
      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'approved' },
        data: expect.objectContaining({
          status: 'expired',
          resultDetail: expect.stringContaining('ไม่ได้กดส่ง') as unknown,
        }) as unknown,
      });
    });

    it('มีคนตัดสินไปก่อนพอดี (count 0): ไม่นับ ไม่แจ้ง', async () => {
      requests.findMany.mockResolvedValue([pending]);
      requests.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.expireOverdue()).resolves.toBe(0);
      expect(notification.send).not.toHaveBeenCalled();
    });
  });

  describe('docs/30 — คำขอที่ผูก Config Override', () => {
    const OVERRIDE_ID = '77777777-7777-4777-8777-777777777777';
    let overrides: { findFirst: jest.Mock; updateMany: jest.Mock };

    beforeEach(() => {
      overrides = {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
      prisma.deviceConfigOverride = overrides;
    });

    describe('approve', () => {
      it('อนุมัติคำขอ = อนุมัติ Override ที่ผูกในทรานแซกชันเดียวกัน', async () => {
        requests.findUniqueOrThrow.mockResolvedValue({
          ...approvedRequest,
          overrideId: OVERRIDE_ID,
        });

        await service.approve(REQUEST_ID, decider);

        expect(overrides.updateMany).toHaveBeenCalledWith({
          where: { id: OVERRIDE_ID, status: 'pending' },
          data: expect.objectContaining({
            status: 'approved',
            decidedBy: decider.id,
          }) as unknown,
        });
      });

      it('Override ถูกตัดสินไปแล้ว (count 0): 409 ไม่แจ้งช่าง', async () => {
        requests.findUniqueOrThrow.mockResolvedValue({
          ...approvedRequest,
          overrideId: OVERRIDE_ID,
        });
        overrides.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.approve(REQUEST_ID, decider),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(notification.send).not.toHaveBeenCalled();
      });

      it('คำขอไม่ผูก Override: ไม่แตะตาราง Override', async () => {
        requests.findUniqueOrThrow.mockResolvedValue(approvedRequest);

        await service.approve(REQUEST_ID, decider);

        expect(overrides.updateMany).not.toHaveBeenCalled();
      });
    });

    it('reject: ปิด Override ที่ผูกเป็น rejected พร้อมเหตุผลเดียวกัน', async () => {
      requests.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        status: 'rejected',
        overrideId: OVERRIDE_ID,
      });

      await service.reject(
        REQUEST_ID,
        { rejectReason: ' เกินค่าที่ลูกค้าอนุญาต ' },
        decider,
      );

      expect(overrides.updateMany).toHaveBeenCalledWith({
        where: { id: OVERRIDE_ID, status: 'pending' },
        data: expect.objectContaining({
          status: 'rejected',
          rejectReason: 'เกินค่าที่ลูกค้าอนุญาต',
          decidedBy: decider.id,
        }) as unknown,
      });
    });

    describe('cancel', () => {
      it('ยกเลิกคำขอ pending: ปิด Override ที่ผูกด้วย', async () => {
        const linked = { ...pending, overrideId: OVERRIDE_ID };
        requests.findUnique.mockResolvedValue(linked);
        requests.findUniqueOrThrow.mockResolvedValue({
          ...linked,
          status: 'cancelled',
        });

        await service.cancel(REQUEST_ID, tech);

        expect(overrides.updateMany).toHaveBeenCalledWith({
          where: { id: OVERRIDE_ID, status: 'pending' },
          data: expect.objectContaining({
            status: 'rejected',
            decidedBy: null,
          }) as unknown,
        });
      });

      it('ยกเลิกคำขอที่อนุมัติแล้ว: Override อนุมัติไปแล้ว ไม่แตะ', async () => {
        const linked = { ...approvedRequest, overrideId: OVERRIDE_ID };
        requests.findUnique.mockResolvedValue(linked);
        requests.findUniqueOrThrow.mockResolvedValue({
          ...linked,
          status: 'cancelled',
        });

        await service.cancel(REQUEST_ID, tech);

        expect(overrides.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('expireOverdue', () => {
      it('คำขอ pending หมดอายุ: ปิด Override ที่ผูกพร้อมเหตุผลเดียวกับคำขอ', async () => {
        requests.findMany.mockResolvedValue([
          { ...pending, overrideId: OVERRIDE_ID },
        ]);

        await expect(service.expireOverdue()).resolves.toBe(1);
        expect(overrides.updateMany).toHaveBeenCalledWith({
          where: { id: OVERRIDE_ID, status: 'pending' },
          data: expect.objectContaining({
            status: 'rejected',
            rejectReason: expect.stringContaining('หมดอายุ') as unknown,
          }) as unknown,
        });
      });

      it('คำขอ approved หมดอายุ: Override อนุมัติไปแล้ว ไม่แตะ', async () => {
        requests.findMany.mockResolvedValue([
          { ...approvedRequest, overrideId: OVERRIDE_ID },
        ]);

        await expect(service.expireOverdue()).resolves.toBe(1);
        expect(overrides.updateMany).not.toHaveBeenCalled();
      });

      it('มีคนตัดสินไปก่อนพอดี (count 0): ไม่ปิด Override', async () => {
        requests.findMany.mockResolvedValue([
          { ...pending, overrideId: OVERRIDE_ID },
        ]);
        requests.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.expireOverdue()).resolves.toBe(0);
        expect(overrides.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('createForOverride', () => {
      it('Config ของงาน: สร้างคำขอ config ผูก Override พร้อมผู้ผูก Config ของงาน · ไม่แจ้งเอง', async () => {
        const created = await service.createForOverride(
          prisma as never,
          { task, configId: CONFIG_ID, overrideId: OVERRIDE_ID },
          tech,
        );

        expect(requests.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            taskId: TASK_ID,
            deviceId: DEVICE_ID,
            kind: 'config',
            configId: CONFIG_ID,
            configAssignedBy: assigner.id,
            overrideId: OVERRIDE_ID,
            requestedBy: tech.id,
          }) as unknown,
        });
        expect(created.overrideId).toBe(OVERRIDE_ID);
        expect(auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            action: 'config_apply_request',
          }) as unknown,
        });
        // ผู้เรียกแจ้งหลัง commit ผ่าน notifyCreated()
        expect(notification.send).not.toHaveBeenCalled();
      });

      it('Config ปัจจุบันไม่ใช่ Config ของงาน: configAssignedBy = null', async () => {
        await service.createForOverride(
          prisma as never,
          {
            task: { ...task, configId: null },
            configId: CONFIG_ID,
            overrideId: OVERRIDE_ID,
          },
          tech,
        );

        expect(requests.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            configAssignedBy: null,
          }) as unknown,
        });
      });

      it('งานไม่ใช่ของช่างคนนี้: 409 ไม่สร้าง', async () => {
        await expect(
          service.createForOverride(
            prisma as never,
            { task, configId: CONFIG_ID, overrideId: OVERRIDE_ID },
            { id: 'tech-2', role: 'ST' },
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.create).not.toHaveBeenCalled();
      });

      it('เครื่องมีคำขอค้าง: 409 ไม่สร้าง (Override rollback ไปด้วยในทรานแซกชันของผู้เรียก)', async () => {
        requests.findFirst.mockResolvedValue(approvedRequest);

        await expect(
          service.createForOverride(
            prisma as never,
            { task, configId: CONFIG_ID, overrideId: OVERRIDE_ID },
            tech,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.create).not.toHaveBeenCalled();
      });

      it('notifyCreated: แจ้ง Operation เหมือนคำขอปกติ', async () => {
        await service.notifyCreated({ ...pending, overrideId: OVERRIDE_ID });

        expect(notification.send).toHaveBeenCalled();
      });
    });
  });

  describe('ผลจาก Rollout เครื่องเดียว (§3.5 ข้อ 5)', () => {
    const sending = { ...pending, status: 'sending', rolloutId: ROLLOUT_ID };

    it('succeeded: อัปเดตเฉพาะคำขอที่ sending แล้วแจ้ง config_apply_succeeded', async () => {
      requests.findUniqueOrThrow.mockResolvedValue({
        ...sending,
        status: 'succeeded',
      });

      await expect(
        service.recordRolloutOutcome({
          rolloutId: ROLLOUT_ID,
          outcome: 'succeeded',
          detail: 'กล่องรับ Config ใหม่สำเร็จ',
        }),
      ).resolves.toBe(true);

      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { rolloutId: ROLLOUT_ID, status: 'sending' },
        data: expect.objectContaining({ status: 'succeeded' }) as unknown,
      });
      expect(notification.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'config_apply_succeeded' }),
      );
    });

    it('skipped_offline: สถานะ skipped_offline แต่แจ้งเป็น config_apply_failed พร้อมเหตุผล (§3.6)', async () => {
      requests.findUniqueOrThrow.mockResolvedValue({
        ...sending,
        status: 'skipped_offline',
      });

      await service.recordRolloutOutcome({
        rolloutId: ROLLOUT_ID,
        outcome: 'skipped_offline',
        detail: 'กล่องออฟไลน์',
      });

      expect(notification.send).toHaveBeenCalledWith({
        userId: tech.id,
        type: 'config_apply_failed',
        payload: {
          requestId: REQUEST_ID,
          kind: 'config',
          taskId: TASK_ID,
          deviceId: DEVICE_ID,
          outcome: 'skipped_offline',
          detail: 'กล่องออฟไลน์',
        },
      });
    });

    it('ไม่มีคำขอ sending ของ Rollout นี้ (Rollout ปกติของ Campaign): false ไม่แจ้ง', async () => {
      requests.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordRolloutOutcome({
          rolloutId: ROLLOUT_ID,
          outcome: 'failed',
          detail: 'x',
        }),
      ).resolves.toBe(false);
      expect(notification.send).not.toHaveBeenCalled();
    });

    it('DB ล้ม: false ไม่ throw (listener ของ event)', async () => {
      requests.updateMany.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordRolloutOutcome({
          rolloutId: ROLLOUT_ID,
          outcome: 'failed',
          detail: 'x',
        }),
      ).resolves.toBe(false);
    });

    it('ฟัง FIELD_APPLY_RESULT_EVENT จาก RolloutEvents', async () => {
      requests.findUniqueOrThrow.mockResolvedValue({
        ...sending,
        status: 'failed',
      });

      events.emit(FIELD_APPLY_RESULT_EVENT, {
        rolloutId: ROLLOUT_ID,
        outcome: 'failed',
        detail: 'กล่องปฏิเสธ',
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(requests.updateMany).toHaveBeenCalledWith({
        where: { rolloutId: ROLLOUT_ID, status: 'sending' },
        data: expect.objectContaining({ status: 'failed' }) as unknown,
      });
    });
  });

  describe('อ่าน', () => {
    it('listForTask: ใช้กฎเห็นงานของ TaskService (404 ถ้าเห็นงานไม่ได้)', async () => {
      taskService.findOne.mockRejectedValue(new NotFoundException());

      await expect(
        service.listForTask(TASK_ID, { id: 'tech-2', role: 'OT' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(requests.findMany).not.toHaveBeenCalled();
    });

    it('listForTask: ใหม่สุดก่อน พร้อมเวอร์ชัน Firmware ของคำขอ (docs/27 B2)', async () => {
      await service.listForTask(TASK_ID, tech);

      expect(requests.findMany).toHaveBeenCalledWith({
        where: { taskId: TASK_ID },
        orderBy: { requestedAt: 'desc' },
        include: {
          firmware: { select: { id: true, version: true } },
          // docs/30 — การ์ดหน้างานแสดงค่าที่ช่างขอ Override
          override: { select: { id: true, reason: true, fields: true } },
        },
      });
    });

    it('list: คืนชื่อ field ที่จะส่ง ไม่คืนค่า field ของ Config', async () => {
      requests.findMany.mockResolvedValue([
        {
          ...pending,
          task: { id: TASK_ID, title: task.title },
          config: {
            id: CONFIG_ID,
            name: config.name,
            deviceModel: 'GT06N',
            protocol: 'TCP',
            fields: config.fields,
          },
          requester: { id: tech.id, fullName: 'ST Tester' },
          configAssigner: { id: assigner.id, fullName: 'Operation A' },
          decider: null,
        },
      ]);

      const [row] = await service.list('pending');

      expect(row.fieldNames).toEqual(['APN', 'SERVER_PORT']);
      expect(row.config).not.toHaveProperty('fields');
      expect(requests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'pending' } }),
      );
    });
  });

  describe('applyOptions (docs/28 §5.2)', () => {
    const configRow = (id: string, name: string, version?: number) => ({
      id,
      name,
      status: 'approved',
      fields: { APN: `apn-${id}`, INTERVAL: 30 },
      versions: version === undefined ? [] : [{ versionNumber: version }],
    });

    beforeEach(() => {
      (prisma.task as Record<string, jest.Mock>).findFirst = jest
        .fn()
        .mockResolvedValue(null);
      (prisma.config as Record<string, jest.Mock>).findMany = jest
        .fn()
        .mockResolvedValue([
          configRow('a', 'A มาตรฐาน', 3),
          configRow(CONFIG_ID, 'B ลูกค้าพิเศษ'),
        ]);
    });

    it('กรองตามสถานะ/ไม่ถูกลบ/รุ่น+โปรโตคอลของกล่อง และ latestVersion 0 เมื่อไม่มีเวอร์ชัน', async () => {
      const result = await service.applyOptions(DEVICE_ID, tech);

      expect(
        (prisma.config as Record<string, jest.Mock>).findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: { in: ['approved', 'synced'] },
            deletedAt: null,
            deviceModel: 'GT06N',
            protocol: 'TCP',
          },
        }),
      );
      expect(result).toEqual({
        deviceId: DEVICE_ID,
        deviceInstalled: true,
        configs: [
          {
            id: 'a',
            name: 'A มาตรฐาน',
            status: 'approved',
            latestVersion: 3,
            suggested: false,
            fields: { APN: 'apn-a', INTERVAL: 30 },
          },
          {
            id: CONFIG_ID,
            name: 'B ลูกค้าพิเศษ',
            status: 'approved',
            latestVersion: 0,
            suggested: false,
            fields: { APN: `apn-${CONFIG_ID}`, INTERVAL: 30 },
          },
        ],
        // โหมด mock ไม่มี Server กลาง — ไม่รู้เวอร์ชันในกล่อง
        currentFirmwareVersion: null,
        firmwares: [],
        openRequest: null,
      });
    });

    it('fields = ค่าที่จะส่งจริง: Config + Override ที่อนุมัติแล้วล่าสุดของกล่องนี้ (ต่อ Config)', async () => {
      prisma.deviceConfigOverride = {
        findMany: jest.fn().mockResolvedValue([
          { configId: 'a', versionNumber: 5, fields: { INTERVAL: 10 } },
          { configId: 'a', versionNumber: 2, fields: { INTERVAL: 99 } },
        ]),
      };

      const result = await service.applyOptions(DEVICE_ID, tech);

      expect(prisma.deviceConfigOverride.findMany).toHaveBeenCalledWith({
        where: {
          deviceId: DEVICE_ID,
          status: 'approved',
          configId: { in: ['a', CONFIG_ID] },
        },
        orderBy: { versionNumber: 'desc' },
        select: { configId: true, fields: true },
      });
      expect(result.configs[0].fields).toEqual({ APN: 'apn-a', INTERVAL: 10 });
      expect(result.configs[1].fields).toEqual({
        APN: `apn-${CONFIG_ID}`,
        INTERVAL: 30,
      });
    });

    it('มีคำขอค้าง: บอกชนิด/สถานะ/สิ่งที่ขอ + taskId เมื่อผู้เรียกถืองานนั้น', async () => {
      requests.findFirst.mockResolvedValue({
        kind: 'firmware',
        status: 'approved',
        taskId: TASK_ID,
        config: null,
        firmware: { version: '1.0.0' },
        task: { assignedTo: tech.id },
      });

      const result = await service.applyOptions(DEVICE_ID, tech);

      expect(result.openRequest).toEqual({
        kind: 'firmware',
        status: 'approved',
        configName: null,
        firmwareVersion: '1.0.0',
        taskId: TASK_ID,
      });
      expect(requests.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deviceId: DEVICE_ID,
            status: { in: ['pending', 'approved', 'sending'] },
          },
        }),
      );
    });

    it('คำขอค้างเป็นของงานช่างคนอื่น: ไม่เปิดเผย taskId', async () => {
      requests.findFirst.mockResolvedValue({
        kind: 'config',
        status: 'pending',
        taskId: 'other-task',
        config: { name: 'B ลูกค้าพิเศษ' },
        firmware: null,
        task: { assignedTo: 'someone-else' },
      });

      const result = await service.applyOptions(DEVICE_ID, tech);

      expect(result.openRequest).toMatchObject({
        configName: 'B ลูกค้าพิเศษ',
        taskId: null,
      });
    });

    it('Config ที่ Operation ผูกกับงานที่ช่างเปิดอยู่ของกล่องนี้ขึ้นก่อนเป็น suggested', async () => {
      (prisma.task as Record<string, jest.Mock>).findFirst.mockResolvedValue({
        configId: CONFIG_ID,
      });

      const result = await service.applyOptions(DEVICE_ID, tech);

      expect(result.configs.map((c) => [c.id, c.suggested])).toEqual([
        [CONFIG_ID, true],
        ['a', false],
      ]);
      expect(
        (prisma.task as Record<string, jest.Mock>).findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assignedTo: tech.id,
            deviceId: DEVICE_ID,
          }) as unknown,
        }),
      );
    });

    it('กล่องยังไม่ติดตั้ง: deviceInstalled false', async () => {
      (prisma.device as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        { ...device, status: 'registered' },
      );

      const result = await service.applyOptions(DEVICE_ID, tech);

      expect(result.deviceInstalled).toBe(false);
    });

    it('ไม่พบกล่อง: 404', async () => {
      (prisma.device as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.applyOptions(DEVICE_ID, tech),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Firmware (docs/27 B2)', () => {
    const firmwareRequest: ConfigApplyRequest = {
      ...pending,
      kind: 'firmware',
      configId: null,
      configAssignedBy: null,
      firmwareId: FIRMWARE_ID,
      fromFirmwareVersion: '2.1.0',
      isDowngrade: true,
    };
    const approvedFirmwareRequest: ConfigApplyRequest = {
      ...firmwareRequest,
      status: 'approved',
      decidedBy: decider.id,
      decidedAt: new Date('2026-10-22T01:00:00.000Z'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const firmwareMock = () => prisma.firmware as Record<string, jest.Mock>;

    /** Server กลางรายงานกล่องนี้ออนไลน์ด้วย Firmware [reported] */
    function centralReports(reported: string | null): void {
      central.findDevice.mockResolvedValue({
        list: { reachable: true },
        device: {
          deviceId: DEVICE_ID,
          online: true,
          reportedFirmwareVersion: reported,
        },
      });
    }

    function createdData(): ConfigApplyRequest {
      return (
        requests.create.mock.calls[0] as [{ data: ConfigApplyRequest }]
      )[0].data;
    }

    describe('create', () => {
      it('โหมด mock: สร้างคำขอ Firmware ไม่มี Config/ผู้ผูก · ไม่รู้เวอร์ชันในกล่อง = ไม่ถอย', async () => {
        await service.create(
          TASK_ID,
          { kind: 'firmware', firmwareId: FIRMWARE_ID },
          tech,
        );

        const data = createdData();
        expect(data.kind).toBe('firmware');
        expect(data.firmwareId).toBe(FIRMWARE_ID);
        expect(data).not.toHaveProperty('configId');
        expect(data).not.toHaveProperty('configAssignedBy');
        expect(data.fromFirmwareVersion).toBeNull();
        expect(data.isDowngrade).toBe(false);
        expect(central.findDevice).not.toHaveBeenCalled();
        expect(auditLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            action: 'config_apply_request',
            metadata: { deviceId: DEVICE_ID, firmwareId: FIRMWARE_ID },
          }) as unknown,
        });
        expect(notification.send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'config_apply_pending',
            payload: expect.objectContaining({ kind: 'firmware' }) as unknown,
          }),
        );
      });

      it.each([
        [
          'ส่ง configId มากับ kind=firmware',
          { kind: 'firmware', firmwareId: FIRMWARE_ID, configId: CONFIG_ID },
        ],
        ['kind=firmware แต่ไม่ส่ง firmwareId', { kind: 'firmware' }],
        ['คำขอ Config แต่ส่ง firmwareId', { firmwareId: FIRMWARE_ID }],
      ] as const)('%s -> 400', async (_label, dto) => {
        await expect(service.create(TASK_ID, dto, tech)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(requests.create).not.toHaveBeenCalled();
      });

      it.each([
        ['QA ยังไม่อนุมัติ', { approvalStatus: 'pending_review' }],
        ['อัปโหลดยังไม่สำเร็จ', { uploadStatus: 'pending' }],
        ['ไม่รองรับรุ่นกล่อง', { deviceModelCompatibility: ['GT08-4G'] }],
      ])('Firmware %s -> 409', async (_label, patch) => {
        firmwareMock().findUnique.mockResolvedValue({ ...firmware, ...patch });

        await expect(
          service.create(
            TASK_ID,
            { kind: 'firmware', firmwareId: FIRMWARE_ID },
            tech,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.create).not.toHaveBeenCalled();
      });

      it('ไม่พบ Firmware -> 404', async () => {
        firmwareMock().findUnique.mockResolvedValue(null);

        await expect(
          service.create(
            TASK_ID,
            { kind: 'firmware', firmwareId: FIRMWARE_ID },
            tech,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      describe('โหมด central — เวอร์ชันจาก Server กลาง', () => {
        beforeEach(async () => {
          service = await build(starter, 'central');
        });

        it('กล่องรันเวอร์ชันสูงกว่า -> isDowngrade + เก็บเวอร์ชันต้นทาง', async () => {
          centralReports('2.1.0');

          await service.create(
            TASK_ID,
            { kind: 'firmware', firmwareId: FIRMWARE_ID },
            tech,
          );

          expect(createdData().fromFirmwareVersion).toBe('2.1.0');
          expect(createdData().isDowngrade).toBe(true);
        });

        it('กล่องรันเวอร์ชันต่ำกว่า -> อัปเกรด ไม่ใช่ถอย', async () => {
          centralReports('1.9.9');

          await service.create(
            TASK_ID,
            { kind: 'firmware', firmwareId: FIRMWARE_ID },
            tech,
          );

          expect(createdData().fromFirmwareVersion).toBe('1.9.9');
          expect(createdData().isDowngrade).toBe(false);
        });

        it('กล่องรันเวอร์ชันเดียวกันอยู่แล้ว -> 409 ไม่สร้างคำขอ', async () => {
          centralReports('2.0.0');

          await expect(
            service.create(
              TASK_ID,
              { kind: 'firmware', firmwareId: FIRMWARE_ID },
              tech,
            ),
          ).rejects.toThrow('อยู่แล้ว');
          expect(requests.create).not.toHaveBeenCalled();
        });

        it('ติดต่อ Server กลางไม่ได้ -> 503 (fail closed) ไม่สร้างคำขอ', async () => {
          central.findDevice.mockResolvedValue({
            list: { reachable: false },
            device: null,
          });

          await expect(
            service.create(
              TASK_ID,
              { kind: 'firmware', firmwareId: FIRMWARE_ID },
              tech,
            ),
          ).rejects.toBeInstanceOf(ServiceUnavailableException);
          expect(requests.create).not.toHaveBeenCalled();
        });

        it.each([
          ['Server กลางไม่รู้จักกล่อง', null],
          [
            'กล่องยังไม่เคยรายงานเวอร์ชัน',
            {
              deviceId: DEVICE_ID,
              online: true,
              reportedFirmwareVersion: null,
            },
          ],
        ])('%s -> 409', async (_label, centralDevice) => {
          central.findDevice.mockResolvedValue({
            list: { reachable: true },
            device: centralDevice,
          });

          await expect(
            service.create(
              TASK_ID,
              { kind: 'firmware', firmwareId: FIRMWARE_ID },
              tech,
            ),
          ).rejects.toBeInstanceOf(ConflictException);
        });
      });
    });

    describe('approve', () => {
      beforeEach(() => {
        requests.findUnique.mockResolvedValue(firmwareRequest);
        requests.findUniqueOrThrow.mockResolvedValue({
          ...firmwareRequest,
          status: 'approved',
        });
      });

      it('ผู้ขออนุมัติเอง -> 403', async () => {
        await expect(
          service.approve(REQUEST_ID, { ...tech, role: 'Operation' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('ไม่ใช้กฎของ Config: Operation ที่ผูก Config เข้างานอนุมัติคำขอ Firmware ได้ · ไม่ snapshot เวอร์ชัน Config', async () => {
        await service.approve(REQUEST_ID, assigner);

        const update = (
          requests.updateMany.mock.calls[0] as [
            { data: { approvedConfigVersion: number | null } },
          ]
        )[0];
        expect(update.data.approvedConfigVersion).toBeNull();
        expect(configVersions.aggregate).not.toHaveBeenCalled();
      });

      it('Firmware ถูกถอนอนุมัติระหว่างรอ -> 409 ยัง pending', async () => {
        firmwareMock().findUnique.mockResolvedValue({
          ...firmware,
          approvalStatus: 'rejected',
        });

        await expect(
          service.approve(REQUEST_ID, decider),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(requests.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('release', () => {
      beforeEach(() => {
        requests.findUnique.mockResolvedValue(approvedFirmwareRequest);
      });

      it('โหมด mock: สร้าง Rollout Firmware ส่ง firmwareId + allowDowngrade ตามคำขอ', async () => {
        await service.release(REQUEST_ID, tech);

        expect(createRollout).toHaveBeenCalledWith(prisma, {
          kind: 'firmware',
          firmwareId: FIRMWARE_ID,
          allowDowngrade: true,
          requestId: REQUEST_ID,
          deviceId: DEVICE_ID,
          requestedBy: tech.id,
          approvedBy: decider.id,
        });
        expect(startRollout).toHaveBeenCalledWith(ROLLOUT_ID, tech.id);
      });

      it('Firmware ถูกถอนอนุมัติหลังอนุมัติคำขอ -> ปิดเป็น cancelled แล้ว 409', async () => {
        firmwareMock().findUnique.mockResolvedValue({
          ...firmware,
          uploadStatus: 'failed',
        });

        await expect(service.release(REQUEST_ID, tech)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(requests.updateMany).toHaveBeenCalledWith({
          where: { id: REQUEST_ID, status: 'approved' },
          data: expect.objectContaining({ status: 'cancelled' }) as unknown,
        });
        expect(createRollout).not.toHaveBeenCalled();
      });

      describe('โหมด central', () => {
        beforeEach(async () => {
          service = await build(starter, 'central');
        });

        it('เวอร์ชันในกล่องยังเหมือนตอนอนุมัติ -> ส่งได้', async () => {
          centralReports('2.1.0');

          await service.release(REQUEST_ID, tech);

          expect(createRollout).toHaveBeenCalledTimes(1);
        });

        it.each([
          ['กล่องถูกอัปเดตเป็นเวอร์ชันเป้าหมายแล้ว', '2.0.0'],
          ['เวอร์ชันในกล่องเปลี่ยนจนไม่ใช่การถอยแล้ว', '1.5.0'],
        ])(
          '%s -> cancelled + 409 (FIRMWARE_STATE_CHANGED)',
          async (_label, reported) => {
            centralReports(reported);

            await expect(
              service.release(REQUEST_ID, tech),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(requests.updateMany).toHaveBeenCalledWith({
              where: { id: REQUEST_ID, status: 'approved' },
              data: expect.objectContaining({ status: 'cancelled' }) as unknown,
            });
            expect(createRollout).not.toHaveBeenCalled();
          },
        );

        it('ติดต่อ Server กลางไม่ได้ -> 503 คำขอยัง approved (ไม่ปิด)', async () => {
          central.findDevice.mockResolvedValue({
            list: { reachable: false },
            device: null,
          });

          await expect(
            service.release(REQUEST_ID, tech),
          ).rejects.toBeInstanceOf(ServiceUnavailableException);
          expect(requests.updateMany).not.toHaveBeenCalled();
          expect(createRollout).not.toHaveBeenCalled();
        });
      });
    });

    it('คิวอนุมัติ: แถว Firmware ได้ config null และไม่มีชื่อ field', async () => {
      requests.findMany.mockResolvedValue([
        {
          ...firmwareRequest,
          task: { id: TASK_ID, title: task.title },
          config: null,
          firmware: { id: FIRMWARE_ID, version: '2.0.0' },
          requester: { id: tech.id, fullName: 'ช่าง' },
          configAssigner: null,
          decider: null,
          releaser: null,
        },
      ]);

      const [row] = await service.list();

      expect(row.config).toBeNull();
      expect(row.fieldNames).toEqual([]);
      expect(row.firmware).toEqual({ id: FIRMWARE_ID, version: '2.0.0' });
      expect(row.isDowngrade).toBe(true);
    });

    describe('applyOptions', () => {
      beforeEach(() => {
        prisma.task = {
          ...(prisma.task as Record<string, jest.Mock>),
          findFirst: jest.fn().mockResolvedValue(null),
        };
        (prisma.config as Record<string, jest.Mock>).findMany = jest
          .fn()
          .mockResolvedValue([]);
        firmwareMock().findMany.mockResolvedValue([
          { id: 'fw-1.0', version: '1.0.0' },
          { id: 'fw-1.10', version: '1.10.0' },
          { id: 'fw-1.2', version: '1.2.0' },
        ]);
      });

      it('โหมด central: ใหม่สุดก่อน + ธงเวอร์ชันปัจจุบัน/ถอยเวอร์ชันเทียบกับกล่อง', async () => {
        service = await build(starter, 'central');
        centralReports('1.2.0');

        const result = await service.applyOptions(DEVICE_ID, tech);

        expect(firmwareMock().findMany).toHaveBeenCalledWith({
          where: {
            uploadStatus: 'stored',
            approvalStatus: 'approved',
            deviceModelCompatibility: { has: 'GT06N' },
          },
          select: { id: true, version: true },
        });
        expect(result.currentFirmwareVersion).toBe('1.2.0');
        expect(result.firmwares).toEqual([
          {
            id: 'fw-1.10',
            version: '1.10.0',
            isCurrent: false,
            isDowngrade: false,
          },
          {
            id: 'fw-1.2',
            version: '1.2.0',
            isCurrent: true,
            isDowngrade: false,
          },
          {
            id: 'fw-1.0',
            version: '1.0.0',
            isCurrent: false,
            isDowngrade: true,
          },
        ]);
      });

      it('ติดต่อ Server กลางไม่ได้ -> ยังตอบรายการได้ เวอร์ชันปัจจุบัน null ไม่ติดธง', async () => {
        service = await build(starter, 'central');
        central.findDevice.mockResolvedValue({
          list: { reachable: false },
          device: null,
        });

        const result = await service.applyOptions(DEVICE_ID, tech);

        expect(result.currentFirmwareVersion).toBeNull();
        expect(result.firmwares.map((f) => f.isDowngrade)).toEqual([
          false,
          false,
          false,
        ]);
      });
    });
  });
});
