import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, TaskService } from './task.service';

type TaskDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
};

const sampleTask: Task = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'ตรวจสอบกล่อง',
  description: null,
  assignedTo: 'tech-1',
  deviceId: null,
  status: 'pending',
  dueDate: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const operation: ActingUser = { id: 'op-1', role: 'Operation' };
const owner: ActingUser = { id: 'tech-1', role: 'ST' };
const otherTech: ActingUser = { id: 'tech-2', role: 'OT' };
const sw: ActingUser = { id: 'sw-1', role: 'SW' };
const auditor: ActingUser = { id: 'auditor-1', role: 'Auditor' };

describe('TaskService', () => {
  let service: TaskService;
  let task: TaskDelegateMock;

  beforeEach(async () => {
    task = {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TaskService, { provide: PrismaService, useValue: { task } }],
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
          dueDate: new Date('2026-02-01T00:00:00.000Z'),
        },
      });
    });

    it.each([sw, owner, otherTech, auditor])(
      'role อื่นที่ไม่ใช่ Operation ($role) สร้างงานไม่ได้: 403',
      async (actor) => {
        await expect(
          service.create({ title: 'x', assignedTo: 'tech-1' }, actor),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(task.create).not.toHaveBeenCalled();
      },
    );
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
            status: undefined,
            dueDate: undefined,
          },
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
          where: { id: sampleTask.id, assignedTo: owner.id },
          data: { status: 'completed' },
        });
      });

      it('แก้ field อื่นนอกจาก status: 403 ไม่เรียก DB เลย', async () => {
        await expect(
          service.update(sampleTask.id, { title: 'hacked' }, owner),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(task.updateMany).not.toHaveBeenCalled();
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

    describe.each([sw, auditor])(
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
          status: undefined,
          dueDate: null,
        },
      });
    });
  });
});
