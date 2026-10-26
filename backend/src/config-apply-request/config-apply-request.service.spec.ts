import {
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

const device = {
  deviceId: DEVICE_ID,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'installed',
};

const pending: ConfigApplyRequest = {
  id: REQUEST_ID,
  taskId: TASK_ID,
  deviceId: DEVICE_ID,
  configId: CONFIG_ID,
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
      create: jest.fn((args: { data: object }) =>
        Promise.resolve({ ...pending, ...args.data, id: REQUEST_ID }),
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
      configApplyRequest: requests,
      configVersion: configVersions,
      campaignRolloutTarget: rolloutTargets,
      deviceConfigOverride: { findFirst: jest.fn().mockResolvedValue(null) },
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

    it('งานไม่มี configId: 409', async () => {
      (prisma.task as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        ...task,
        configId: null,
      });

      await expect(service.create(TASK_ID, {}, tech)).rejects.toBeInstanceOf(
        ConflictException,
      );
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

      it('ข้อ 4: คำขอไม่มีผู้ผูก Config -> 403 (fail closed)', async () => {
        requests.findUnique.mockResolvedValue({
          ...pending,
          configAssignedBy: '',
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
});
