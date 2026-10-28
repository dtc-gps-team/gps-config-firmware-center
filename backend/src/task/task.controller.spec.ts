import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { Request, Response } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

const JWT_SECRET = 'test-secret';

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

function reqAs(payload: JwtPayload): Request & { user: JwtPayload } {
  return { user: payload } as Request & { user: JwtPayload };
}

const operationReq = reqAs({ sub: 'op-1', role: 'Operation' });

describe('TaskController', () => {
  let controller: TaskController;
  let service: jest.Mocked<
    Pick<
      TaskService,
      'findAll' | 'create' | 'findOneWithAssignee' | 'update' | 'start'
    >
  >;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      findOneWithAssignee: jest.fn(),
      update: jest.fn(),
      start: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: service },
        // provide JwtService ตรงๆ เพื่อให้ JwtAuthGuard inject ได้ใน test module
        // (pattern เดียวกับ notification.controller.spec.ts)
        {
          provide: JwtService,
          useValue: new JwtService({ secret: JWT_SECRET }),
        },
        JwtAuthGuard,
        // PermissionGuard ของ POST /tasks/start (docs/28) inject PrismaService —
        // เทสนี้เรียกเมธอด controller ตรงๆ ไม่ผ่าน guard จึงใช้ค่าว่างพอ
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get(TaskController);
  });

  it('GET /tasks -> service.findAll พร้อม query และ actor จาก JWT', async () => {
    service.findAll.mockResolvedValue([sampleTask]);
    const result = await controller.findAll(
      { status: 'pending' },
      operationReq,
    );
    expect(result).toEqual([sampleTask]);
    expect(service.findAll).toHaveBeenCalledWith(
      { status: 'pending' },
      { id: 'op-1', role: 'Operation', ipAddress: null },
    );
  });

  it('POST /tasks -> service.create พร้อม actor จาก JWT', async () => {
    service.create.mockResolvedValue(sampleTask);
    const dto = { title: 'ตรวจสอบกล่อง', assignedTo: 'tech-1' };
    await controller.create(dto, operationReq);
    expect(service.create).toHaveBeenCalledWith(dto, {
      id: 'op-1',
      role: 'Operation',
      ipAddress: null,
    });
  });

  it('GET /tasks/:id -> service.findOneWithAssignee พร้อม actor จาก JWT', async () => {
    const withAssignee = {
      ...sampleTask,
      assignee: { username: 'st.test', fullName: 'ช่าง ทดสอบ' },
    };
    service.findOneWithAssignee.mockResolvedValue(withAssignee);
    await expect(
      controller.findOne(sampleTask.id, operationReq),
    ).resolves.toEqual(withAssignee);
    expect(service.findOneWithAssignee).toHaveBeenCalledWith(sampleTask.id, {
      id: 'op-1',
      role: 'Operation',
      ipAddress: null,
    });
  });

  it('PATCH /tasks/:id -> service.update พร้อม actor จาก JWT', async () => {
    service.update.mockResolvedValue({ ...sampleTask, status: 'completed' });
    await controller.update(
      sampleTask.id,
      { status: 'completed' },
      operationReq,
    );
    expect(service.update).toHaveBeenCalledWith(
      sampleTask.id,
      { status: 'completed' },
      { id: 'op-1', role: 'Operation', ipAddress: null },
    );
  });

  describe('POST /tasks/start (docs/28 §5.1)', () => {
    const stReq = reqAs({ sub: 'tech-1', role: 'ST' });
    let status: jest.Mock;
    let res: Response;
    beforeEach(() => {
      status = jest.fn();
      res = { status } as unknown as Response;
      status.mockReturnValue(res);
    });

    it('สร้างใบใหม่ -> 201 พร้อม actor จาก JWT', async () => {
      service.start.mockResolvedValue({ task: sampleTask, created: true });

      const result = await controller.start(
        { deviceId: 'BOX-0001' },
        stReq,
        res,
      );

      expect(result).toBe(sampleTask);
      expect(status).toHaveBeenCalledWith(201);
      expect(service.start).toHaveBeenCalledWith(
        { deviceId: 'BOX-0001' },
        { id: 'tech-1', role: 'ST', ipAddress: null },
      );
    });

    it('ได้ใบเดิมที่ยังเปิดอยู่ -> 200', async () => {
      service.start.mockResolvedValue({ task: sampleTask, created: false });

      await controller.start({ deviceId: 'BOX-0001' }, stReq, res);

      expect(status).toHaveBeenCalledWith(200);
    });
  });
});
