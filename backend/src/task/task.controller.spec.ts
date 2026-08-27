import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

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
      providers: [{ provide: TaskService, useValue: service }],
    }).compile();

    controller = module.get(TaskController);
  });

  it('GET /tasks -> service.findAll พร้อม query', async () => {
    service.findAll.mockResolvedValue([sampleTask]);
    const result = await controller.findAll({ status: 'pending' });
    expect(result).toEqual([sampleTask]);
    expect(service.findAll).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('POST /tasks -> service.create', async () => {
    service.create.mockResolvedValue(sampleTask);
    const dto = { title: 'ตรวจสอบกล่อง', assignedTo: 'tech-1' };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('GET /tasks/:id -> service.findOne', async () => {
    service.findOne.mockResolvedValue(sampleTask);
    await controller.findOne(sampleTask.id);
    expect(service.findOne).toHaveBeenCalledWith(sampleTask.id);
  });

  it('PATCH /tasks/:id -> service.update', async () => {
    service.update.mockResolvedValue({ ...sampleTask, status: 'completed' });
    await controller.update(sampleTask.id, { status: 'completed' });
    expect(service.update).toHaveBeenCalledWith(sampleTask.id, {
      status: 'completed',
    });
  });
});
