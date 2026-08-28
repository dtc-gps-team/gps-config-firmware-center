import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService } from './task.service';

type TaskDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
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

describe('TaskService', () => {
  let service: TaskService;
  let task: TaskDelegateMock;

  beforeEach(async () => {
    task = {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TaskService, { provide: PrismaService, useValue: { task } }],
    }).compile();

    service = module.get(TaskService);
  });

  describe('create', () => {
    it('map DTO และแปลง dueDate เป็น Date', async () => {
      task.create.mockResolvedValue(sampleTask);

      await service.create({
        title: 'ตรวจสอบกล่อง',
        assignedTo: 'tech-1',
        dueDate: '2026-02-01T00:00:00.000Z',
      });

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
  });

  describe('findAll', () => {
    it('ส่ง filter status / assignedTo เข้า where', async () => {
      task.findMany.mockResolvedValue([sampleTask]);

      const result = await service.findAll({
        status: 'pending',
        assignedTo: 'tech-1',
      });

      expect(result).toEqual([sampleTask]);
      expect(task.findMany).toHaveBeenCalledWith({
        where: { status: 'pending', assignedTo: 'tech-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('คืนงานเมื่อเจอ', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      await expect(service.findOne(sampleTask.id)).resolves.toEqual(sampleTask);
    });

    it('โยน NotFoundException เมื่อไม่เจอ', async () => {
      task.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('โยน NotFoundException เมื่อไม่มีงานนั้น', async () => {
      task.findUnique.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: 'completed' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(task.update).not.toHaveBeenCalled();
    });

    it('อัปเดต status เมื่อพบงาน', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, status: 'completed' });

      const result = await service.update(sampleTask.id, {
        status: 'completed',
      });

      expect(result.status).toBe('completed');
      expect(task.update).toHaveBeenCalledWith({
        where: { id: sampleTask.id },
        data: {
          title: undefined,
          description: undefined,
          assignedTo: undefined,
          deviceId: undefined,
          status: 'completed',
          dueDate: undefined,
        },
      });
    });

    it('ล้าง dueDate ได้ด้วยการส่ง null', async () => {
      task.findUnique.mockResolvedValue(sampleTask);
      task.update.mockResolvedValue({ ...sampleTask, dueDate: null });

      await service.update(sampleTask.id, { dueDate: null });

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
