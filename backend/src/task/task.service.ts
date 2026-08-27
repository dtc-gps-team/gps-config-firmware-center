import { Injectable, NotFoundException } from '@nestjs/common';
import { Task } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

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
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTaskDto): Promise<Task> {
    return this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        assignedTo: dto.assignedTo,
        deviceId: dto.deviceId,
        dueDate: toDbDate(dto.dueDate),
      },
    });
  }

  findAll(query: QueryTaskDto): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: {
        status: query.status,
        assignedTo: query.assignedTo,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException(`ไม่พบงาน id ${id}`);
    }
    return task;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    await this.findOne(id);
    return this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        assignedTo: dto.assignedTo,
        deviceId: dto.deviceId,
        status: dto.status,
        dueDate: toDbDate(dto.dueDate),
      },
    });
  }
}
