import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActingUser,
  configAssignment,
  resolveChangedAt,
  TASK_IDLE_CLOSE_HOURS,
  TaskService,
  technicianTaskTitle,
} from './task.service';

/** จำลอง Prisma error ให้ตรงกับ shape จริงของ PrismaClientKnownRequestError
 * (ต้องมี code + clientVersion) — default เป็น P2025 ("Record to update not
 * found") ส่ง code อื่นเข้ามาได้เพื่อเทสว่า guard เช็ค code จริง ไม่ได้จับทุก
 * PrismaClientKnownRequestError */
function makePrismaError(code = 'P2025'): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Record to update not found.', {
    code,
    clientVersion: 'test',
  });
}

type TaskDelegateMock = {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

const CONFIG_ID = '99999999-9999-9999-9999-999999999999';

const sampleTask: Task = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'ตรวจสอบกล่อง',
  description: null,
  assignedTo: 'tech-1',
  deviceId: null,
  configId: null,
  campaignId: null,
  configAssignedBy: null,
  configAssignedAt: null,
  status: 'pending',
  dueDate: null,
  source: 'operation',
  completedAt: null,
  autoClosed: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const approvedConfig = {
  id: CONFIG_ID,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'approved' as const,
};

const operation: ActingUser = { id: 'op-1', role: 'Operation' };
const owner: ActingUser = { id: 'tech-1', role: 'ST' };
const otherTech: ActingUser = { id: 'tech-2', role: 'OT' };
const configEngineer: ActingUser = { id: 'ce-1', role: 'ConfigEngineer' };
const auditor: ActingUser = { id: 'auditor-1', role: 'Auditor' };
const admin: ActingUser = { id: 'admin-1', role: 'Admin' };
const superAdmin: ActingUser = { id: 'superadmin-1', role: 'SuperAdmin' };

describe('TaskService', () => {
  let service: TaskService;
  let task: TaskDelegateMock;
  let config: { findUnique: jest.Mock };
  let device: { findUnique: jest.Mock };
  let auditLog: { create: jest.Mock };
  let notification: { send: jest.Mock };
  let taskEvent: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  // `SELECT ... FOR UPDATE` ของ lockTask() — default คืนแถวของ sampleTask
  // (สถานะ pending) เทสไหนต้องการสถานะก่อนหน้าอื่นค่อย mock ทับ
  let queryRaw: jest.Mock;
  // docs/25 §3.9 — ยกเลิกงานแล้วปิดคำขอส่ง Config ที่ pending ตาม
  let configApplyRequest: { updateMany: jest.Mock; findFirst: jest.Mock };
  // docs/30 §3 — Override ที่ผูกคำขอซึ่งถูกยกเลิกตามงานต้องปิดเป็น rejected ด้วย
  let deviceConfigOverride: { updateMany: jest.Mock };
  let user: { findUnique: jest.Mock };

  beforeEach(async () => {
    task = {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    config = { findUnique: jest.fn() };
    device = { findUnique: jest.fn() };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    notification = { send: jest.fn().mockResolvedValue(undefined) };
    taskEvent = {
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn(),
      // event เปลี่ยนสถานะล่าสุด (ขอบล่างของ changedAt) — default ไม่มี
      findFirst: jest.fn().mockResolvedValue(null),
    };
    configApplyRequest = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
    };
    deviceConfigOverride = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    user = { findUnique: jest.fn().mockResolvedValue(null) };
    queryRaw = jest
      .fn()
      .mockResolvedValue([
        { status: sampleTask.status, createdAt: sampleTask.createdAt },
      ]);
    // $transaction (interactive form) เรียก callback ด้วย prisma mock ตัวเดียวกัน
    // เป็น tx — pattern เดียวกับ config.service.spec.ts
    const prisma: Record<string, unknown> = {
      task,
      config,
      device,
      auditLog,
      taskEvent,
      configApplyRequest,
      deviceConfigOverride,
      user,
      $queryRaw: queryRaw,
    };
    prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        { provide: NotificationService, useValue: notification },
      ],
    }).compile();

    service = module.get(TaskService);
  });

  describe('create', () => {
    it('Operation สร้างงานได้: map DTO และแปลง dueDate เป็น Date', async () => {
      task.create.mockResolvedValue(sampleTask);

      await service.create(
        {
          title: 'ตรวจสอบกล่อง',
          assignedTo: 'tech-1',
          dueDate: '2026-02-01T00:00:00.000Z',
        },
        operation,
      );

      expect(task.create).toHaveBeenCalledWith({
        data: {
          title: 'ตรวจสอบกล่อง',
          description: undefined,
          assignedTo: 'tech-1',
          deviceId: undefined,
          configId: undefined,
          dueDate: new Date('2026-02-01T00:00:00.000Z'),
        },
      });
    });

    it.each([configEngineer, owner, otherTech, auditor])(
      'role อื่นที่ไม่ใช่ Operation ($role) สร้างงานไม่ได้: 403',
      async (actor) => {
        await expect(
          service.create({ title: 'x', assignedTo: 'tech-1' }, actor),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(task.create).not.toHaveBeenCalled();
      },
    );

    describe('configId', () => {
      it('Config approved/synced: ผูกกับงานได้ ส่ง configId เข้า create', async () => {
        config.findUnique.mockResolvedValue(approvedConfig);
        task.create.mockResolvedValue({ ...sampleTask, configId: CONFIG_ID });

        await service.create(
          { title: 'ติดตั้ง', assignedTo: 'tech-1', configId: CONFIG_ID },
          operation,
        );

        expect(config.findUnique).toHaveBeenCalledWith({
          where: { id: CONFIG_ID },
        });
        expect(task.create).toHaveBeenCalledWith({
          data: {
            title: 'ติดตั้ง',
            description: undefined,
            assignedTo: 'tech-1',
            deviceId: undefined,
            configId: CONFIG_ID,
            configAssignedBy: operation.id,
            configAssignedAt: expect.any(Date) as unknown,
            dueDate: undefined,
          },
        });
      });

      it('ไม่พบ Config: 404 ไม่สร้างงาน', async () => {
        config.findUnique.mockResolvedValue(null);

        await expect(
          service.create(
            { title: 'x', assignedTo: 'tech-1', configId: CONFIG_ID },
            operation,
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(task.create).not.toHaveBeenCalled();
      });

      it('Config สถานะ draft: 409 ไม่สร้างงาน', async () => {
        config.findUnique.mockResolvedValue({
          ...approvedConfig,
          status: 'draft',
        });

        await expect(
          service.create(
            { title: 'x', assignedTo: 'tech-1', configId: CONFIG_ID },
            operation,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(task.create).not.toHaveBeenCalled();
      });

      it('deviceId มี Device record จริงแต่คนละรุ่นกับ Config: 409', async () => {
        config.findUnique.mockResolvedValue(approvedConfig);
        device.findUnique.mockResolvedValue({
          deviceId: 'DEV-0001',
          deviceModel: 'GT06L',
          protocol: 'TCP',
        });

        await expect(
          service.create(
            {
              title: 'x',
              assignedTo: 'tech-1',
              deviceId: 'DEV-0001',
              configId: CONFIG_ID,
            },
            operation,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(task.create).not.toHaveBeenCalled();
      });

      it('deviceId ยังไม่มี Device record: ข้ามการเช็ครุ่น สร้างงานได้', async () => {
        config.findUnique.mockResolvedValue(approvedConfig);
        device.findUnique.mockResolvedValue(null);
        task.create.mockResolvedValue(sampleTask);

        await service.create(
          {
            title: 'x',
            assignedTo: 'tech-1',
            deviceId: 'DEV-FLOATING',
            configId: CONFIG_ID,
          },
          operation,
        );

        expect(task.create).toHaveBeenCalled();
      });
    });
  });

  describe('findAll', () => {
    it('Operation: ส่ง filter status / assignedTo ตามที่ client ระบุ', async () => {
      task.findMany.mockResolvedValue([sampleTask]);

      const result = await service.findAll(
        { status: 'pending', assignedTo: 'tech-1' },
        operation,
      );

      expect(result).toEqual([sampleTask]);
      expect(task.findMany).toHaveBeenCalledWith({
        where: { status: 'pending', assignedTo: 'tech-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('ST/OT: บังคับ assignedTo เป็นตัวเองเสมอ ไม่ว่า client จะส่ง assignedTo อะไรมา', async () => {
      task.findMany.mockResolvedValue([sampleTask]);

      await service.findAll({ assignedTo: 'someone-else' }, owner);

      expect(task.findMany).toHaveBeenCalledWith({
        where: { status: undefined, assignedTo: owner.id },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('Auditor: ไม่ scope เหมือน Operation (ตั้งใจให้เห็นทุก task เพื่อตรวจสอบย้อนหลัง)', async () => {
      task.findMany.mockResolvedValue([sampleTask]);

      await service.findAll({ status: 'pending' }, auditor);

      expect(task.findMany).toHaveBeenCalledWith({
        where: { status: 'pending', assignedTo: undefined },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('Admin/SuperAdmin: ไม่ scope เช่นกัน (ดูแลระบบ ต้อง troubleshoot งานของใครก็ได้)', async () => {
      task.findMany.mockResolvedValue([sampleTask]);

      await service.findAll({}, admin);
      await service.findAll({}, superAdmin);

      expect(task.findMany).toHaveBeenCalledWith({
        where: { status: undefined, assignedTo: undefined },
        orderBy: { createdAt: 'desc' },
      });
      expect(task.findMany).toHaveBeenCalledTimes(2);
    });

    it('issue #73 — role อื่นที่ไม่อยู่ใน UNSCOPED_TASK_ROLES ถูก self-scope เป็น default ปลอดภัย (เช่น ConfigEngineer ต่อให้ได้ grant tasks:Read เพิ่มทีหลังโดยไม่ได้ตั้งใจ ก็ไม่หลุดเห็นทั้งตาราง)', async () => {
      task.findMany.mockResolvedValue([sampleTask]);

      await service.findAll({ assignedTo: 'someone-else' }, configEngineer);

      expect(task.findMany).toHaveBeenCalledWith({
        where: { status: undefined, assignedTo: configEngineer.id },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOneWithAssignee', () => {
    it('แนบชื่อผู้รับผิดชอบ (username + fullName) จาก Task.assignedTo', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      user.findUnique.mockResolvedValue({
        username: 'st.test',
        fullName: 'ช่าง ทดสอบ',
      });
      await expect(
        service.findOneWithAssignee(sampleTask.id, owner),
      ).resolves.toEqual({
        ...sampleTask,
        assignee: { username: 'st.test', fullName: 'ช่าง ทดสอบ' },
      });
      expect(user.findUnique).toHaveBeenCalledWith({
        where: { id: sampleTask.assignedTo },
        select: { username: true, fullName: true },
      });
    });

    it('หาบัญชีไม่เจอ -> assignee เป็น null (ไม่ throw)', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      await expect(
        service.findOneWithAssignee(sampleTask.id, operation),
      ).resolves.toEqual({ ...sampleTask, assignee: null });
    });

    it('กฎเห็นงานเดียวกับ findOne: ST/OT ที่ไม่ใช่เจ้าของ -> 404 ไม่ query ผู้ใช้', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      await expect(
        service.findOneWithAssignee(sampleTask.id, otherTech),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('Operation: คืนงานเมื่อเจอ ไม่ว่าใครเป็นเจ้าของ', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      await expect(service.findOne(sampleTask.id, operation)).resolves.toEqual(
        sampleTask,
      );
    });

    it('โยน NotFoundException เมื่อไม่เจอ', async () => {
      task.findUnique.mockResolvedValue(null);
      await expect(
        service.findOne('missing', operation),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ST/OT ที่เป็นเจ้าของงาน: เห็นงานตัวเอง', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      await expect(service.findOne(sampleTask.id, owner)).resolves.toEqual(
        sampleTask,
      );
    });

    it('ST/OT ที่ไม่ใช่เจ้าของงาน: 404 (ไม่เปิดเผยว่ามี record นี้อยู่)', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      await expect(
        service.findOne(sampleTask.id, otherTech),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([auditor, admin, superAdmin])(
      'issue #73 — $role (UNSCOPED_TASK_ROLES): เห็นงานได้ ไม่ว่าใครเป็นเจ้าของ',
      async (actor) => {
        task.findUnique.mockResolvedValue(sampleTask);
        await expect(service.findOne(sampleTask.id, actor)).resolves.toEqual(
          sampleTask,
        );
      },
    );

    it('issue #73 ข้อ 3 — role ที่ไม่อยู่ใน UNSCOPED_TASK_ROLES/SELF_SCOPED_ROLES เลย: 404 เสมอแม้ไม่มี PermissionGuard คุม endpoint นี้ (default-deny ไม่ใช่ default-allow)', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      await expect(
        service.findOne(sampleTask.id, configEngineer),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    describe('Operation', () => {
      it('โยน NotFoundException เมื่อไม่มีงานนั้น', async () => {
        task.findUnique.mockResolvedValue(null);
        await expect(
          service.update('missing', { status: 'completed' }, operation),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(task.update).not.toHaveBeenCalled();
      });

      it('race condition: row ถูกลบไปพอดีระหว่าง findOne กับ update (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        task.update.mockRejectedValue(makePrismaError('P2025'));

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, operation),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('PrismaClientKnownRequestError ที่ code อื่น (P2002): โยนต่อตามเดิม ไม่กลายเป็น 404', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        const other = makePrismaError('P2002');
        task.update.mockRejectedValue(other);

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, operation),
        ).rejects.toBe(other);
      });

      it('แก้ทุก field ได้ ไม่ว่างานนั้นเป็นของใคร', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        task.update.mockResolvedValue({ ...sampleTask, title: 'แก้ไขแล้ว' });

        const result = await service.update(
          sampleTask.id,
          { title: 'แก้ไขแล้ว' },
          operation,
        );

        expect(result.title).toBe('แก้ไขแล้ว');
        expect(task.update).toHaveBeenCalledWith({
          where: { id: sampleTask.id },
          data: {
            title: 'แก้ไขแล้ว',
            description: undefined,
            assignedTo: undefined,
            deviceId: undefined,
            configId: undefined,
            status: undefined,
            dueDate: undefined,
          },
        });
      });

      describe('configId', () => {
        it('ผูก Config approved ใหม่ได้: validate แล้วส่ง configId เข้า update', async () => {
          task.findUnique.mockResolvedValue(sampleTask);
          config.findUnique.mockResolvedValue(approvedConfig);
          task.update.mockResolvedValue({ ...sampleTask, configId: CONFIG_ID });

          await service.update(
            sampleTask.id,
            { configId: CONFIG_ID },
            operation,
          );

          expect(config.findUnique).toHaveBeenCalledWith({
            where: { id: CONFIG_ID },
          });
          expect(task.update).toHaveBeenCalledWith({
            where: { id: sampleTask.id },
            data: {
              title: undefined,
              description: undefined,
              assignedTo: undefined,
              deviceId: undefined,
              configId: CONFIG_ID,
              configAssignedBy: operation.id,
              configAssignedAt: expect.any(Date) as unknown,
              status: undefined,
              dueDate: undefined,
            },
          });
        });

        it('configId ที่ไม่พบ Config: 404 ไม่เรียก update', async () => {
          task.findUnique.mockResolvedValue(sampleTask);
          config.findUnique.mockResolvedValue(null);

          await expect(
            service.update(sampleTask.id, { configId: CONFIG_ID }, operation),
          ).rejects.toBeInstanceOf(NotFoundException);
          expect(task.update).not.toHaveBeenCalled();
        });

        it('Config สถานะ testing: 409 ไม่เรียก update', async () => {
          task.findUnique.mockResolvedValue(sampleTask);
          config.findUnique.mockResolvedValue({
            ...approvedConfig,
            status: 'testing',
          });

          await expect(
            service.update(sampleTask.id, { configId: CONFIG_ID }, operation),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(task.update).not.toHaveBeenCalled();
        });

        it('ล้าง configId ได้ด้วย null (ไม่ validate)', async () => {
          task.findUnique.mockResolvedValue({
            ...sampleTask,
            configId: CONFIG_ID,
          });
          task.update.mockResolvedValue({ ...sampleTask, configId: null });

          await service.update(sampleTask.id, { configId: null }, operation);

          expect(config.findUnique).not.toHaveBeenCalled();
          expect(task.update).toHaveBeenCalledWith({
            where: { id: sampleTask.id },
            data: {
              title: undefined,
              description: undefined,
              assignedTo: undefined,
              deviceId: undefined,
              configId: null,
              configAssignedBy: null,
              configAssignedAt: null,
              status: undefined,
              dueDate: undefined,
            },
          });
        });

        it('validate ใช้ deviceId เดิมของงานเมื่อ dto ไม่ได้ส่ง deviceId มา', async () => {
          task.findUnique.mockResolvedValue({
            ...sampleTask,
            deviceId: 'DEV-0001',
          });
          config.findUnique.mockResolvedValue(approvedConfig);
          device.findUnique.mockResolvedValue({
            deviceId: 'DEV-0001',
            deviceModel: 'GT06L',
            protocol: 'TCP',
          });

          await expect(
            service.update(sampleTask.id, { configId: CONFIG_ID }, operation),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(device.findUnique).toHaveBeenCalledWith({
            where: { deviceId: 'DEV-0001' },
          });
        });
      });
    });

    describe('ST/OT (เจ้าของงาน)', () => {
      it('แก้ status ได้: 200', async () => {
        task.updateMany.mockResolvedValue({ count: 1 });
        task.findUniqueOrThrow.mockResolvedValue({
          ...sampleTask,
          status: 'completed',
        });

        const result = await service.update(
          sampleTask.id,
          { status: 'completed' },
          owner,
        );

        expect(result.status).toBe('completed');
        expect(task.updateMany).toHaveBeenCalledWith({
          where: {
            id: sampleTask.id,
            assignedTo: owner.id,
            status: { notIn: ['cancelled', 'completed'] },
          },
          data: { status: 'completed' },
        });
      });

      it('แก้ field อื่นนอกจาก status: 403 ไม่เรียก DB เลย', async () => {
        await expect(
          service.update(sampleTask.id, { title: 'hacked' }, owner),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(task.updateMany).not.toHaveBeenCalled();
      });

      it('ส่ง configId มาด้วย (สิทธิ์ Operation เท่านั้น): 403 ไม่เรียก DB', async () => {
        await expect(
          service.update(sampleTask.id, { configId: CONFIG_ID }, owner),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(task.updateMany).not.toHaveBeenCalled();
        expect(config.findUnique).not.toHaveBeenCalled();
      });

      it.each(['cancelled', 'pending'] as const)(
        'issue #73 ข้อ 2 — ตั้งสถานะเป็น "%s": 403 ไม่เรียก DB (mirror ตัวเลือกที่ Mobile ให้ ST/OT เห็นแค่ in_progress/completed)',
        async (status) => {
          await expect(
            service.update(sampleTask.id, { status }, owner),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(task.updateMany).not.toHaveBeenCalled();
        },
      );

      it.each(['in_progress', 'completed'] as const)(
        'issue #73 ข้อ 2 — ตั้งสถานะเป็น "%s": ผ่าน (สถานะที่ ST/OT ตั้งเองได้)',
        async (status) => {
          task.updateMany.mockResolvedValue({ count: 1 });
          task.findUniqueOrThrow.mockResolvedValue({ ...sampleTask, status });

          await expect(
            service.update(sampleTask.id, { status }, owner),
          ).resolves.toMatchObject({ status });
          expect(task.updateMany).toHaveBeenCalledWith({
            where: {
              id: sampleTask.id,
              assignedTo: owner.id,
              status: { notIn: ['cancelled', 'completed'] },
            },
            data: { status },
          });
        },
      );
    });

    // คำตอบ A ใน #303 ข้อ 1 — งานที่เสร็จแล้ว (completed) เป็นสถานะสุดท้าย
    // สำหรับ ST/OT เหมือน cancelled ห้ามย้อนกลับ ต้องได้ 409
    describe('ST/OT (งานเสร็จแล้ว)', () => {
      it.each(['in_progress', 'completed'] as const)(
        'เจ้าของงานตั้ง "%s" ทับงานที่ completed: 409 (ไม่ย้อนสถานะ)',
        async (status) => {
          task.updateMany.mockResolvedValue({ count: 0 });
          task.findUnique.mockResolvedValue({
            ...sampleTask,
            assignedTo: owner.id,
            status: 'completed',
          });

          await expect(
            service.update(sampleTask.id, { status }, owner),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(task.findUniqueOrThrow).not.toHaveBeenCalled();
        },
      );

      it('คนที่ไม่ใช่เจ้าของงานที่ completed: 404 ไม่ใช่ 409 (ไม่เปิดเผยสถานะงานคนอื่น)', async () => {
        task.updateMany.mockResolvedValue({ count: 0 });
        task.findUnique.mockResolvedValue({
          ...sampleTask,
          assignedTo: owner.id,
          status: 'completed',
        });

        await expect(
          service.update(sampleTask.id, { status: 'in_progress' }, otherTech),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('งานที่ยังไม่เสร็จ (in_progress -> completed) ยังเปลี่ยนได้ตามปกติ', async () => {
        task.updateMany.mockResolvedValue({ count: 1 });
        task.findUniqueOrThrow.mockResolvedValue({
          ...sampleTask,
          status: 'completed',
        });

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, owner),
        ).resolves.toMatchObject({ status: 'completed' });
      });
    });

    describe('ST/OT (งานถูกยกเลิกแล้ว)', () => {
      it.each(['in_progress', 'completed'] as const)(
        'เจ้าของงานตั้ง "%s" ทับงานที่ cancelled: 409 (ไม่ฟื้นงาน)',
        async (status) => {
          task.updateMany.mockResolvedValue({ count: 0 });
          task.findUnique.mockResolvedValue({
            ...sampleTask,
            assignedTo: owner.id,
            status: 'cancelled',
          });

          await expect(
            service.update(sampleTask.id, { status }, owner),
          ).rejects.toBeInstanceOf(ConflictException);
        },
      );

      it('คนที่ไม่ใช่เจ้าของงานที่ cancelled: 404 ไม่ใช่ 409 (ไม่เปิดเผยสถานะงานคนอื่น)', async () => {
        task.updateMany.mockResolvedValue({ count: 0 });
        task.findUnique.mockResolvedValue({
          ...sampleTask,
          assignedTo: owner.id,
          status: 'cancelled',
        });

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, otherTech),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('งานไม่มีอยู่จริง: 404', async () => {
        task.updateMany.mockResolvedValue({ count: 0 });
        task.findUnique.mockResolvedValue(null);

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, owner),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe('ST/OT (ไม่ใช่เจ้าของงาน)', () => {
      it('แก้ status ของงานคนอื่น: 404 (updateMany count = 0)', async () => {
        task.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, otherTech),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe.each([configEngineer, auditor])(
      'role ที่ไม่มีสิทธิ์แก้เลย ($role)',
      (actor) => {
        it('403 เสมอ ไม่ว่างานนั้นเป็นของใคร', async () => {
          await expect(
            service.update(sampleTask.id, { status: 'completed' }, actor),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(task.update).not.toHaveBeenCalled();
          expect(task.updateMany).not.toHaveBeenCalled();
        });
      },
    );

    it('ล้าง dueDate ได้ด้วยการส่ง null (Operation)', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, dueDate: null });

      await service.update(sampleTask.id, { dueDate: null }, operation);

      expect(task.update).toHaveBeenCalledWith({
        where: { id: sampleTask.id },
        data: {
          title: undefined,
          description: undefined,
          assignedTo: undefined,
          deviceId: undefined,
          configId: undefined,
          status: undefined,
          dueDate: null,
        },
      });
    });
  });

  describe('แจ้งเตือน task_assigned', () => {
    it('create(): ส่ง task_assigned ให้คนที่ถูก assign 1 ครั้ง', async () => {
      const created = { ...sampleTask, id: 'task-new', assignedTo: 'tech-7' };
      task.create.mockResolvedValue(created);

      await service.create(
        { title: created.title, assignedTo: 'tech-7' },
        operation,
      );

      expect(notification.send).toHaveBeenCalledTimes(1);
      expect(notification.send).toHaveBeenCalledWith({
        userId: 'tech-7',
        type: 'task_assigned',
        payload: { taskId: 'task-new', title: created.title },
      });
    });

    it('update() โดย Operation ย้ายงานไปคนใหม่: ส่ง task_assigned ให้คนใหม่', async () => {
      task.findUnique.mockResolvedValue(sampleTask); // assignedTo: 'tech-1'
      const updated = { ...sampleTask, assignedTo: 'tech-9' };
      task.update.mockResolvedValue(updated);

      await service.update(sampleTask.id, { assignedTo: 'tech-9' }, operation);

      expect(notification.send).toHaveBeenCalledTimes(1);
      expect(notification.send).toHaveBeenCalledWith({
        userId: 'tech-9',
        type: 'task_assigned',
        payload: { taskId: sampleTask.id, title: sampleTask.title },
      });
    });

    it('update() โดย Operation ไม่ได้ส่ง assignedTo (แก้แค่ title): ไม่ส่ง notification', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, title: 'ใหม่' });

      await service.update(sampleTask.id, { title: 'ใหม่' }, operation);

      expect(notification.send).not.toHaveBeenCalled();
    });

    it('update() โดย Operation ส่ง assignedTo มาแต่ค่าเดิม: ไม่ส่ง notification', async () => {
      task.findUnique.mockResolvedValue(sampleTask); // assignedTo: 'tech-1'
      task.update.mockResolvedValue(sampleTask);

      await service.update(
        sampleTask.id,
        { assignedTo: sampleTask.assignedTo },
        operation,
      );

      expect(notification.send).not.toHaveBeenCalled();
    });

    it('update() โดย ST/OT (แก้ status): ไม่ส่ง notification', async () => {
      task.updateMany.mockResolvedValue({ count: 1 });
      task.findUniqueOrThrow.mockResolvedValue({
        ...sampleTask,
        status: 'completed',
      });

      await service.update(sampleTask.id, { status: 'completed' }, owner);

      expect(notification.send).not.toHaveBeenCalled();
    });

    it('create() ยังสำเร็จปกติแม้ notification.send reject (never-throw)', async () => {
      const created = { ...sampleTask, id: 'task-x' };
      task.create.mockResolvedValue(created);
      notification.send.mockRejectedValue(new Error('FCM ล่ม'));

      await expect(
        service.create({ title: 'x', assignedTo: 'tech-1' }, operation),
      ).resolves.toEqual(created);
    });

    it('update() (ย้ายงาน) ยังสำเร็จปกติแม้ notification.send reject', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      const updated = { ...sampleTask, assignedTo: 'tech-9' };
      task.update.mockResolvedValue(updated);
      notification.send.mockRejectedValue(new Error('FCM ล่ม'));

      await expect(
        service.update(sampleTask.id, { assignedTo: 'tech-9' }, operation),
      ).resolves.toEqual(updated);
    });
  });

  describe('AuditLog (Sprint 3 #27 follow-up — PR #145 เปิด audit module แล้ว)', () => {
    it('create() -> เขียน action create หลังสร้างงานสำเร็จ', async () => {
      task.create.mockResolvedValue(sampleTask);

      await service.create({ title: 'x', assignedTo: 'tech-1' }, operation);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: operation.id, auditModule: 'task', action: 'create' },
      });
    });

    it('update() โดย Operation -> เขียน action update', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, title: 'แก้ไขแล้ว' });

      await service.update(sampleTask.id, { title: 'แก้ไขแล้ว' }, operation);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: operation.id, auditModule: 'task', action: 'update' },
      });
    });

    it('update() โดย ST/OT (แก้ status ตัวเอง) -> เขียน action update ด้วย userId ของ ST/OT เอง', async () => {
      task.updateMany.mockResolvedValue({ count: 1 });
      task.findUniqueOrThrow.mockResolvedValue({
        ...sampleTask,
        status: 'completed',
      });

      await service.update(sampleTask.id, { status: 'completed' }, owner);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: owner.id, auditModule: 'task', action: 'update' },
      });
    });

    it('update() ที่โยน 403/404 ก่อนถึงจุด mutation -> ไม่เขียน AuditLog เลย', async () => {
      await expect(
        service.update(sampleTask.id, { title: 'hacked' }, owner),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('create() ยังสำเร็จปกติแม้ auditLog.create reject (never-throw)', async () => {
      const created = { ...sampleTask, id: 'task-x' };
      task.create.mockResolvedValue(created);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.create({ title: 'x', assignedTo: 'tech-1' }, operation),
      ).resolves.toEqual(created);
    });

    it('update() โดย Operation ยังสำเร็จปกติแม้ auditLog.create reject', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, title: 'แก้ไขแล้ว' });
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.update(sampleTask.id, { title: 'แก้ไขแล้ว' }, operation),
      ).resolves.toEqual({ ...sampleTask, title: 'แก้ไขแล้ว' });
    });

    it('update() โดย ST/OT ยังสำเร็จปกติแม้ auditLog.create reject', async () => {
      task.updateMany.mockResolvedValue({ count: 1 });
      task.findUniqueOrThrow.mockResolvedValue({
        ...sampleTask,
        status: 'completed',
      });
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.update(sampleTask.id, { status: 'completed' }, owner),
      ).resolves.toEqual({ ...sampleTask, status: 'completed' });
    });
  });

  describe('Task Event History (issue #296)', () => {
    describe('create() เขียน event "สร้างงาน"', () => {
      it('null -> pending ในทรานแซกชันเดียวกับ Task · changedBy = ผู้สร้าง · changedAt = Task.createdAt', async () => {
        task.create.mockResolvedValue(sampleTask);

        await service.create(
          { title: sampleTask.title, assignedTo: 'tech-1' },
          operation,
        );

        expect(taskEvent.create).toHaveBeenCalledWith({
          data: {
            taskId: sampleTask.id,
            fromStatus: null,
            toStatus: 'pending',
            changedBy: operation.id,
            changedAt: sampleTask.createdAt,
          },
        });
      });
    });

    describe('update() เขียน event เปลี่ยนสถานะ', () => {
      function ownerUpdates(nextStatus: Task['status']) {
        task.updateMany.mockResolvedValue({ count: 1 });
        task.findUniqueOrThrow.mockResolvedValue({
          ...sampleTask,
          status: nextStatus,
        });
      }

      it('ST เปลี่ยน pending -> in_progress: fromStatus มาจากแถวที่ล็อกไว้ในทรานแซกชัน', async () => {
        ownerUpdates('in_progress');

        await service.update(sampleTask.id, { status: 'in_progress' }, owner);

        expect(queryRaw).toHaveBeenCalled();
        expect(taskEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            taskId: sampleTask.id,
            fromStatus: 'pending',
            toStatus: 'in_progress',
            changedBy: owner.id,
          }) as unknown,
        });
      });

      it('ใช้ changedAt จาก client (เวลาที่ช่างกดตอนเข้าคิว offline)', async () => {
        ownerUpdates('in_progress');
        const tappedAt = '2026-01-02T03:04:05.000Z';

        await service.update(
          sampleTask.id,
          { status: 'in_progress', changedAt: tappedAt },
          owner,
        );

        expect(taskEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            changedAt: new Date(tappedAt),
          }) as unknown,
        });
      });

      it('ส่งสถานะเดิมซ้ำ (เช่น คิว offline ส่งซ้ำ): ไม่เกิด event', async () => {
        ownerUpdates('in_progress');
        queryRaw.mockResolvedValue([
          { status: 'in_progress', createdAt: sampleTask.createdAt },
        ]);

        await service.update(sampleTask.id, { status: 'in_progress' }, owner);

        expect(taskEvent.create).not.toHaveBeenCalled();
      });

      it('Operation แก้แค่ title (ไม่ส่ง status): ไม่เกิด event', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        task.update.mockResolvedValue({ ...sampleTask, title: 'ใหม่' });

        await service.update(sampleTask.id, { title: 'ใหม่' }, operation);

        expect(taskEvent.create).not.toHaveBeenCalled();
      });

      it('Operation ยกเลิกงาน: event in_progress -> cancelled', async () => {
        queryRaw.mockResolvedValue([
          { status: 'in_progress', createdAt: sampleTask.createdAt },
        ]);
        task.findUnique.mockResolvedValue({
          ...sampleTask,
          status: 'in_progress',
        });
        task.update.mockResolvedValue({ ...sampleTask, status: 'cancelled' });

        await service.update(sampleTask.id, { status: 'cancelled' }, operation);

        expect(taskEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            fromStatus: 'in_progress',
            toStatus: 'cancelled',
            changedBy: operation.id,
          }) as unknown,
        });
      });

      it('updateMany ไม่โดนแถวไหน (ไม่ใช่งานตัวเอง): 404 ไม่เกิด event', async () => {
        task.updateMany.mockResolvedValue({ count: 0 });
        task.findUnique.mockResolvedValue({ ...sampleTask, assignedTo: 'x' });

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, owner),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(taskEvent.create).not.toHaveBeenCalled();
      });

      it('Operation: แถวหายไประหว่าง findOne กับการล็อก -> 404 ไม่ update', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        queryRaw.mockResolvedValue([]);

        await expect(
          service.update(sampleTask.id, { status: 'completed' }, operation),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(task.update).not.toHaveBeenCalled();
      });

      it('ส่ง changedAt โดยไม่ส่ง status: 400 ไม่แตะ DB', async () => {
        await expect(
          service.update(
            sampleTask.id,
            { changedAt: '2026-01-02T00:00:00.000Z' },
            owner,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(task.updateMany).not.toHaveBeenCalled();
      });

      it('ST: changedAt ย้อนไปก่อน event เปลี่ยนสถานะล่าสุด -> ปัดขึ้นเป็นเวลาของ event นั้น (Operation เปลี่ยนคั่นระหว่างช่างออฟไลน์ — รีวิว A บน #302)', async () => {
        ownerUpdates('completed');
        queryRaw.mockResolvedValue([
          { status: 'in_progress', createdAt: sampleTask.createdAt },
        ]);
        const operationChangedAt = new Date('2026-01-05T11:00:00.000Z');
        taskEvent.findFirst.mockResolvedValue({
          changedAt: operationChangedAt,
        });

        await service.update(
          sampleTask.id,
          { status: 'completed', changedAt: '2026-01-05T10:30:00.000Z' },
          owner,
        );

        expect(taskEvent.findFirst).toHaveBeenCalledWith({
          where: { taskId: sampleTask.id, toStatus: { not: null } },
          orderBy: { changedAt: 'desc' },
          select: { changedAt: true },
        });
        expect(taskEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            fromStatus: 'in_progress',
            toStatus: 'completed',
            changedAt: operationChangedAt,
          }) as unknown,
        });
      });

      it('ST: changedAt หลัง event ล่าสุด -> ใช้เวลาที่ client ส่งมาตามเดิม', async () => {
        ownerUpdates('in_progress');
        taskEvent.findFirst.mockResolvedValue({
          changedAt: new Date('2026-01-02T00:00:00.000Z'),
        });

        await service.update(
          sampleTask.id,
          { status: 'in_progress', changedAt: '2026-01-03T00:00:00.000Z' },
          owner,
        );

        expect(taskEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            changedAt: new Date('2026-01-03T00:00:00.000Z'),
          }) as unknown,
        });
      });

      it('Operation ส่ง changedAt ย้อนหลังมา -> ไม่ใช้ ใช้เวลา server เสมอ (Web ไม่มีคิว offline — รีวิว A บน #302)', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        task.update.mockResolvedValue({ ...sampleTask, status: 'cancelled' });
        const before = Date.now();

        await service.update(
          sampleTask.id,
          { status: 'cancelled', changedAt: '2026-01-01T00:00:01.000Z' },
          operation,
        );

        const data = (
          taskEvent.create.mock.calls[0] as [{ data: { changedAt: Date } }]
        )[0].data;
        expect(data.changedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(data.changedAt.getTime()).toBeLessThanOrEqual(Date.now());
        expect(taskEvent.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('resolveChangedAt', () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const now = new Date('2026-01-10T00:00:00.000Z');

      it('ไม่ส่งมา: ใช้เวลา server', () => {
        expect(resolveChangedAt(undefined, createdAt, now)).toEqual(now);
      });

      it('อยู่ระหว่างสร้างงานกับตอนนี้: ใช้ค่าที่ส่งมา', () => {
        expect(
          resolveChangedAt('2026-01-05T12:00:00.000Z', createdAt, now),
        ).toEqual(new Date('2026-01-05T12:00:00.000Z'));
      });

      it('อยู่ในอนาคต (นาฬิกาเครื่องเดินเร็ว): ปัดลงเป็นเวลา server', () => {
        expect(
          resolveChangedAt('2026-02-01T00:00:00.000Z', createdAt, now),
        ).toEqual(now);
      });

      it('ก่อนงานถูกสร้าง: ปัดขึ้นเป็น Task.createdAt', () => {
        expect(
          resolveChangedAt('2025-12-01T00:00:00.000Z', createdAt, now),
        ).toEqual(createdAt);
      });
    });

    describe('findEvents()', () => {
      const event = {
        id: 'e1',
        taskId: sampleTask.id,
        fromStatus: null,
        toStatus: 'pending',
        changedBy: 'op-1',
        changedAt: sampleTask.createdAt,
        note: null,
        createdAt: sampleTask.createdAt,
        changer: { fullName: 'คุณ Operation' },
      };

      it('เจ้าของงาน (ST): คืน timeline เรียง changedAt เก่าไปใหม่ พร้อมชื่อผู้ทำ', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        taskEvent.findMany.mockResolvedValue([event]);

        const result = await service.findEvents(sampleTask.id, owner);

        expect(taskEvent.findMany).toHaveBeenCalledWith({
          where: { taskId: sampleTask.id },
          orderBy: [{ changedAt: 'asc' }, { createdAt: 'asc' }],
          include: { changer: { select: { fullName: true } } },
        });
        expect(result).toEqual([
          {
            id: 'e1',
            taskId: sampleTask.id,
            fromStatus: null,
            toStatus: 'pending',
            changedBy: 'op-1',
            changedByName: 'คุณ Operation',
            changedAt: sampleTask.createdAt,
            note: null,
          },
        ]);
      });

      it('event ที่ backfill (ไม่รู้ผู้สร้าง): changedBy/changedByName เป็น null', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        taskEvent.findMany.mockResolvedValue([
          { ...event, changedBy: null, changer: null },
        ]);

        const [result] = await service.findEvents(sampleTask.id, operation);

        expect(result.changedBy).toBeNull();
        expect(result.changedByName).toBeNull();
      });

      it.each([
        ['Operation', operation],
        ['Auditor', auditor],
        ['Admin', admin],
        ['SuperAdmin', superAdmin],
      ])(
        '%s เห็น timeline ของงานคนอื่นได้ (กฎเดียวกับ findOne)',
        async (_label, actor) => {
          task.findUnique.mockResolvedValue(sampleTask);
          taskEvent.findMany.mockResolvedValue([]);

          await expect(
            service.findEvents(sampleTask.id, actor),
          ).resolves.toEqual([]);
        },
      );

      it.each([
        ['ST/OT ที่ไม่ใช่เจ้าของงาน', otherTech],
        ['role นอก allowlist (ConfigEngineer)', configEngineer],
      ])('%s: 404 ไม่อ่าน event เลย', async (_label, actor) => {
        task.findUnique.mockResolvedValue(sampleTask);

        await expect(
          service.findEvents(sampleTask.id, actor),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(taskEvent.findMany).not.toHaveBeenCalled();
      });
    });

    describe('addNote()', () => {
      const noteEvent = {
        id: 'n1',
        taskId: sampleTask.id,
        fromStatus: null,
        toStatus: null,
        changedBy: owner.id,
        changedAt: new Date('2026-01-03T00:00:00.000Z'),
        note: 'ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        changer: { fullName: 'ช่าง ST' },
      };

      it('เจ้าของงาน (ST): เพิ่มได้ ตัดช่องว่างหัวท้าย เขียน AuditLog add_note', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        taskEvent.create.mockResolvedValue(noteEvent);

        const result = await service.addNote(
          sampleTask.id,
          { note: '  ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้  ' },
          owner,
        );

        expect(taskEvent.create).toHaveBeenCalledWith({
          data: {
            taskId: sampleTask.id,
            changedBy: owner.id,
            note: 'ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้',
          },
          include: { changer: { select: { fullName: true } } },
        });
        expect(result.note).toBe('ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้');
        expect(result.toStatus).toBeNull();
        expect(result.changedByName).toBe('ช่าง ST');
        expect(auditLog.create).toHaveBeenCalledWith({
          data: { userId: owner.id, auditModule: 'task', action: 'add_note' },
        });
      });

      it('Operation: เพิ่มในงานของคนอื่นได้', async () => {
        task.findUnique.mockResolvedValue(sampleTask);
        taskEvent.create.mockResolvedValue({
          ...noteEvent,
          changedBy: operation.id,
        });

        await expect(
          service.addNote(sampleTask.id, { note: 'ตรวจแล้ว' }, operation),
        ).resolves.toMatchObject({ changedBy: operation.id });
      });

      it('ST/OT ที่ไม่ใช่เจ้าของงาน: 404 (IDOR) ไม่เขียนอะไร', async () => {
        task.findUnique.mockResolvedValue(sampleTask);

        await expect(
          service.addNote(sampleTask.id, { note: 'x' }, otherTech),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(taskEvent.create).not.toHaveBeenCalled();
      });

      it('ไม่มีงานนี้: 404', async () => {
        task.findUnique.mockResolvedValue(null);

        await expect(
          service.addNote(sampleTask.id, { note: 'x' }, operation),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it.each([
        ['Auditor', auditor],
        ['Admin', admin],
        ['SuperAdmin', superAdmin],
        ['ConfigEngineer', configEngineer],
      ])(
        '%s: 403 (อ่าน timeline ได้แต่เพิ่มบันทึกไม่ได้)',
        async (_label, actor) => {
          await expect(
            service.addNote(sampleTask.id, { note: 'x' }, actor),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(task.findUnique).not.toHaveBeenCalled();
        },
      );

      it('งานที่ถูกยกเลิกแล้ว: 409', async () => {
        task.findUnique.mockResolvedValue({
          ...sampleTask,
          status: 'cancelled',
        });

        await expect(
          service.addNote(sampleTask.id, { note: 'x' }, owner),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(taskEvent.create).not.toHaveBeenCalled();
      });

      it('ช่องว่างล้วน: 400', async () => {
        await expect(
          service.addNote(sampleTask.id, { note: '   ' }, owner),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(taskEvent.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('docs/25 — ผู้ผูก Config เข้างาน + ยกเลิกคำขอส่ง Config ตามงาน', () => {
    describe('configAssignment()', () => {
      const at = new Date('2026-10-22T00:00:00.000Z');

      it('ไม่ส่ง configId: ไม่แตะผู้ผูก', () => {
        expect(configAssignment(undefined, operation, at)).toEqual({});
      });

      it('ตั้ง configId: ผู้ผูก = ผู้เรียก + เวลา', () => {
        expect(configAssignment(CONFIG_ID, operation, at)).toEqual({
          configAssignedBy: operation.id,
          configAssignedAt: at,
        });
      });

      it('ล้าง configId (null): ล้างผู้ผูกด้วย', () => {
        expect(configAssignment(null, operation, at)).toEqual({
          configAssignedBy: null,
          configAssignedAt: null,
        });
      });
    });

    it('Operation แก้ title อย่างเดียว: ไม่เขียนผู้ผูก Config (ไม่ทับค่าเดิม)', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, title: 'ใหม่' });

      await service.update(sampleTask.id, { title: 'ใหม่' }, operation);

      const call = task.update.mock.calls[0] as [{ data: object }];
      expect(call[0].data).not.toHaveProperty('configAssignedBy');
      expect(call[0].data).not.toHaveProperty('configAssignedAt');
    });

    it('Operation ยกเลิกงาน: ปิดคำขอส่ง Config ที่ pending/approved ของงานนี้ในทรานแซกชันเดียวกัน (Q9, docs/27)', async () => {
      queryRaw.mockResolvedValue([
        { status: 'in_progress', createdAt: sampleTask.createdAt },
      ]);
      task.findUnique.mockResolvedValue({
        ...sampleTask,
        status: 'in_progress',
      });
      task.update.mockResolvedValue({ ...sampleTask, status: 'cancelled' });

      await service.update(sampleTask.id, { status: 'cancelled' }, operation);

      expect(configApplyRequest.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: sampleTask.id,
          status: { in: ['pending', 'approved'] },
        },
        data: expect.objectContaining({
          status: 'cancelled',
          completedAt: expect.any(Date) as unknown,
        }) as unknown,
      });
    });

    it('docs/30: Operation ยกเลิกงาน → Override ที่ผูกคำขอ pending ของงานนี้ปิดเป็น rejected', async () => {
      queryRaw.mockResolvedValue([
        { status: 'in_progress', createdAt: sampleTask.createdAt },
      ]);
      task.findUnique.mockResolvedValue({
        ...sampleTask,
        status: 'in_progress',
      });
      task.update.mockResolvedValue({ ...sampleTask, status: 'cancelled' });

      await service.update(sampleTask.id, { status: 'cancelled' }, operation);

      expect(deviceConfigOverride.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          applyRequest: { is: { taskId: sampleTask.id } },
        },
        data: {
          status: 'rejected',
          rejectReason: 'งานถูกยกเลิก ระบบยกเลิกคำขอให้อัตโนมัติ',
          decidedBy: null,
          decidedAt: expect.any(Date) as unknown,
        },
      });
      // ยกเลิกคำขอก่อน แล้วค่อยปิด Override (Override ของคำขอที่อนุมัติแล้วเป็น approved ไม่ถูกแตะ)
      expect(
        configApplyRequest.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        deviceConfigOverride.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('Operation เปลี่ยนสถานะอื่น (ไม่ใช่ยกเลิก): ไม่แตะคำขอ', async () => {
      queryRaw.mockResolvedValue([
        { status: 'pending', createdAt: sampleTask.createdAt },
      ]);
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, status: 'in_progress' });

      await service.update(sampleTask.id, { status: 'in_progress' }, operation);

      expect(configApplyRequest.updateMany).not.toHaveBeenCalled();
    });

    it('งานที่ยกเลิกไปแล้ว ส่ง cancelled ซ้ำ: ไม่แตะคำขออีก', async () => {
      queryRaw.mockResolvedValue([
        { status: 'cancelled', createdAt: sampleTask.createdAt },
      ]);
      task.findUnique.mockResolvedValue({ ...sampleTask, status: 'cancelled' });
      task.update.mockResolvedValue({ ...sampleTask, status: 'cancelled' });

      await service.update(sampleTask.id, { status: 'cancelled' }, operation);

      expect(configApplyRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('start (docs/28 §5.1 — ช่างเริ่มงานเอง)', () => {
    const DEVICE = 'BOX-0001';
    const installedDevice = { deviceId: DEVICE, status: 'installed' };

    beforeEach(() => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.create.mockImplementation((args: { data: Partial<Task> }) =>
        Promise.resolve({
          ...sampleTask,
          ...args.data,
          id: 'new-task',
        }),
      );
    });

    it('ไม่มีงานเปิดอยู่: สร้างใบใหม่ source=technician เป็นของผู้เรียก in_progress + event สร้างงาน + audit start · ไม่แจ้ง task_assigned', async () => {
      const result = await service.start({ deviceId: ` ${DEVICE} ` }, owner);

      expect(result.created).toBe(true);
      expect(task.create).toHaveBeenCalledWith({
        data: {
          title: expect.stringContaining(`${DEVICE} — `) as unknown,
          assignedTo: owner.id,
          deviceId: DEVICE,
          status: 'in_progress',
          source: 'technician',
        },
      });
      expect(taskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: 'new-task',
          fromStatus: null,
          toStatus: 'in_progress',
          changedBy: owner.id,
        }) as unknown,
      });
      expect(notification.send).not.toHaveBeenCalled();
      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'start' }) as unknown,
      });
    });

    it('ล็อกต่อ (ช่าง, กล่อง) ก่อนหา/สร้าง กันกดซ้ำพร้อมกันได้ 2 ใบ', async () => {
      await service.start({ deviceId: DEVICE }, owner);

      const lockCall = queryRaw.mock.calls[0] as [TemplateStringsArray, string];
      expect(lockCall[0].join('?')).toContain('pg_advisory_xact_lock');
      expect(lockCall[1]).toBe(`task-start:${owner.id}:${DEVICE}`);
      expect(task.findFirst).toHaveBeenCalledWith({
        where: {
          assignedTo: owner.id,
          deviceId: DEVICE,
          status: { in: ['pending', 'in_progress'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('มีงาน in_progress ของกล่องนี้อยู่แล้ว: คืนใบเดิม (created=false) ไม่สร้างใหม่', async () => {
      const open = { ...sampleTask, deviceId: DEVICE, status: 'in_progress' };
      task.findFirst.mockResolvedValue(open);

      const result = await service.start({ deviceId: DEVICE }, owner);

      expect(result).toEqual({ task: open, created: false });
      expect(task.create).not.toHaveBeenCalled();
      expect(task.update).not.toHaveBeenCalled();
      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'resume' }) as unknown,
      });
    });

    it('มีงาน pending ที่ Operation สั่งไว้: ใช้ใบนั้นและเปลี่ยนเป็น in_progress พร้อม event', async () => {
      task.findFirst.mockResolvedValue({ ...sampleTask, deviceId: DEVICE });
      task.update.mockResolvedValue({
        ...sampleTask,
        deviceId: DEVICE,
        status: 'in_progress',
      });

      const result = await service.start({ deviceId: DEVICE }, owner);

      expect(result.created).toBe(false);
      expect(task.update).toHaveBeenCalledWith({
        where: { id: sampleTask.id },
        data: { status: 'in_progress' },
      });
      expect(taskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromStatus: 'pending',
          toStatus: 'in_progress',
        }) as unknown,
      });
    });

    it('ส่ง note มา: บันทึกเป็น TaskEvent ที่มี note', async () => {
      await service.start({ deviceId: DEVICE, note: ' ตรวจสัญญาณ ' }, owner);

      expect(taskEvent.create).toHaveBeenCalledWith({
        data: { taskId: 'new-task', changedBy: owner.id, note: 'ตรวจสัญญาณ' },
      });
    });

    it('กล่องยังไม่ติดตั้ง (registered): เริ่มงานได้', async () => {
      device.findUnique.mockResolvedValue({
        ...installedDevice,
        status: 'registered',
      });

      await expect(
        service.start({ deviceId: DEVICE }, owner),
      ).resolves.toMatchObject({ created: true });
    });

    it('กล่องปลดระวางแล้ว: 409', async () => {
      device.findUnique.mockResolvedValue({
        ...installedDevice,
        status: 'decommissioned',
      });

      await expect(
        service.start({ deviceId: DEVICE }, owner),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(task.create).not.toHaveBeenCalled();
    });

    it('ไม่พบกล่อง: 404', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(
        service.start({ deviceId: DEVICE }, owner),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([operation, configEngineer, admin])(
      'role ที่ไม่ใช่ช่าง ($role): 403',
      async (actor) => {
        await expect(
          service.start({ deviceId: DEVICE }, actor),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(task.create).not.toHaveBeenCalled();
      },
    );

    it('ชื่องานเป็นเลขเครื่อง + วันที่ไทย', () => {
      expect(
        technicianTaskTitle(DEVICE, new Date('2026-10-26T03:00:00.000Z')),
      ).toBe(`${DEVICE} — 26 ต.ค. 2569`);
    });
  });

  describe('ปิดงาน (docs/28 §5.4)', () => {
    beforeEach(() => {
      queryRaw.mockResolvedValue([
        {
          status: 'in_progress',
          createdAt: sampleTask.createdAt,
          assignedTo: owner.id,
        },
      ]);
      task.updateMany.mockResolvedValue({ count: 1 });
      task.findUniqueOrThrow.mockResolvedValue({
        ...sampleTask,
        status: 'completed',
      });
      task.update.mockResolvedValue({ ...sampleTask, status: 'completed' });
      task.findUnique.mockResolvedValue({
        ...sampleTask,
        status: 'in_progress',
      });
    });

    it('ST กดเสร็จงาน: ตั้ง completedAt และยกเลิกคำขอ pending/approved ด้วยเหตุผลปิดงาน', async () => {
      await service.update(sampleTask.id, { status: 'completed' }, owner);

      expect(task.updateMany).toHaveBeenCalledWith({
        where: {
          id: sampleTask.id,
          assignedTo: owner.id,
          status: { notIn: ['cancelled', 'completed'] },
        },
        data: { status: 'completed', completedAt: expect.any(Date) as unknown },
      });
      expect(configApplyRequest.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: sampleTask.id,
          status: { in: ['pending', 'approved'] },
        },
        data: expect.objectContaining({
          status: 'cancelled',
          resultDetail: 'ช่างปิดงานแล้ว ระบบยกเลิกคำขอให้อัตโนมัติ',
        }) as unknown,
      });
    });

    it('docs/30: ST กดเสร็จงาน → Override ที่ผูกคำขอ pending ของงานนี้ปิดเป็น rejected', async () => {
      await service.update(sampleTask.id, { status: 'completed' }, owner);

      expect(deviceConfigOverride.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          applyRequest: { is: { taskId: sampleTask.id } },
        },
        data: {
          status: 'rejected',
          rejectReason: 'ช่างปิดงานแล้ว ระบบยกเลิกคำขอให้อัตโนมัติ',
          decidedBy: null,
          decidedAt: expect.any(Date) as unknown,
        },
      });
    });

    it('ST กดเสร็จงานระหว่างคำขอ sending: 409 ไม่เปลี่ยนสถานะงาน', async () => {
      configApplyRequest.findFirst.mockResolvedValue({ id: 'req-sending' });

      await expect(
        service.update(sampleTask.id, { status: 'completed' }, owner),
      ).rejects.toThrow('รอผลจากกล่องก่อน');
      expect(task.updateMany).not.toHaveBeenCalled();
      expect(configApplyRequest.updateMany).not.toHaveBeenCalled();
    });

    it('ST ที่ไม่ใช่เจ้าของงานกดเสร็จ: ไม่เช็ค/ไม่ยกเลิกคำขอของคนอื่น (404 ตามเดิม)', async () => {
      configApplyRequest.findFirst.mockResolvedValue({ id: 'req-sending' });
      task.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update(sampleTask.id, { status: 'completed' }, otherTech),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(configApplyRequest.findFirst).not.toHaveBeenCalled();
      expect(configApplyRequest.updateMany).not.toHaveBeenCalled();
    });

    it('ST เปลี่ยนเป็น in_progress: ไม่ตั้ง completedAt ไม่แตะคำขอ', async () => {
      await service.update(sampleTask.id, { status: 'in_progress' }, owner);

      expect(task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'in_progress' } }),
      );
      expect(configApplyRequest.updateMany).not.toHaveBeenCalled();
    });

    it('Operation ปิดงาน: กติกาเดียวกัน (sending -> 409)', async () => {
      configApplyRequest.findFirst.mockResolvedValue({ id: 'req-sending' });

      await expect(
        service.update(sampleTask.id, { status: 'completed' }, operation),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(task.update).not.toHaveBeenCalled();
    });

    it('Operation ปิดงาน: ตั้ง completedAt + ยกเลิกคำขอ', async () => {
      await service.update(sampleTask.id, { status: 'completed' }, operation);

      expect(task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'completed',
            completedAt: expect.any(Date) as unknown,
          }) as unknown,
        }),
      );
      expect(configApplyRequest.updateMany).toHaveBeenCalled();
    });
  });

  describe('autoCloseIdle (docs/28 D4)', () => {
    const now = new Date('2026-10-27T12:00:00.000Z');
    const cutoff = new Date(
      now.getTime() - TASK_IDLE_CLOSE_HOURS * 60 * 60 * 1000,
    );

    beforeEach(() => {
      task.findMany.mockResolvedValue([{ id: 'idle-1' }, { id: 'idle-2' }]);
      task.updateMany.mockResolvedValue({ count: 1 });
    });

    it('หางานที่เงียบเกิน 24 ชม. ตามเงื่อนไขครบ (ไม่มี event/คำขอขยับ, ไม่มี sending, dueDate เลยหรือว่าง)', async () => {
      await service.autoCloseIdle(now);

      expect(task.findMany).toHaveBeenCalledWith({
        where: {
          status: 'in_progress',
          updatedAt: { lt: cutoff },
          events: { none: { changedAt: { gte: cutoff } } },
          configApplyRequests: {
            none: {
              OR: [{ status: 'sending' }, { updatedAt: { gte: cutoff } }],
            },
          },
          OR: [{ dueDate: null }, { dueDate: { lt: now } }],
        },
        select: { id: true },
      });
    });

    it('ปิดเป็น completed + autoClosed พร้อม event ของระบบ (changedBy null) และยกเลิกคำขอที่ค้าง · คืนจำนวนที่ปิด', async () => {
      const closed = await service.autoCloseIdle(now);

      expect(closed).toBe(2);
      expect(task.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'idle-1',
          status: 'in_progress',
        }) as unknown,
        data: { status: 'completed', completedAt: now, autoClosed: true },
      });
      expect(taskEvent.create).toHaveBeenCalledWith({
        data: {
          taskId: 'idle-1',
          fromStatus: 'in_progress',
          toStatus: 'completed',
          changedBy: null,
          changedAt: now,
          note: 'ระบบปิดงานให้ (ไม่มีความเคลื่อนไหว 24 ชม.)',
        },
      });
      expect(configApplyRequest.updateMany).toHaveBeenCalledTimes(2);
      expect(deviceConfigOverride.updateMany).toHaveBeenCalledTimes(2);
    });

    it('งานขยับระหว่างรอ (เช็คซ้ำหลังล็อกไม่ผ่าน): ข้าม ไม่เขียน event', async () => {
      task.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const closed = await service.autoCloseIdle(now);

      expect(closed).toBe(1);
      expect(taskEvent.create).toHaveBeenCalledTimes(1);
    });
  });
});
