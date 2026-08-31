import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

const JWT_SECRET = 'test-secret';

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

function reqAs(payload: JwtPayload): Request & { user: JwtPayload } {
  return { user: payload } as Request & { user: JwtPayload };
}

const operationReq = reqAs({ sub: 'op-1', role: 'Operation' });

describe('TaskController', () => {
  let controller: TaskController;
  let service: jest.Mocked<
    Pick<TaskService, 'findAll' | 'create' | 'findOne' | 'update'>
  >;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
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
      { id: 'op-1', role: 'Operation' },
    );
  });

  it('POST /tasks -> service.create พร้อม actor จาก JWT', async () => {
    service.create.mockResolvedValue(sampleTask);
    const dto = { title: 'ตรวจสอบกล่อง', assignedTo: 'tech-1' };
    await controller.create(dto, operationReq);
    expect(service.create).toHaveBeenCalledWith(dto, {
      id: 'op-1',
      role: 'Operation',
    });
  });

  it('GET /tasks/:id -> service.findOne พร้อม actor จาก JWT', async () => {
    service.findOne.mockResolvedValue(sampleTask);
    await controller.findOne(sampleTask.id, operationReq);
    expect(service.findOne).toHaveBeenCalledWith(sampleTask.id, {
      id: 'op-1',
      role: 'Operation',
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
      { id: 'op-1', role: 'Operation' },
    );
  });
});
