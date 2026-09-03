import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Task } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

const OPERATION_ROLE = 'Operation';
// ST/OT = ผู้ใช้ Mobile ที่เห็น/แก้ได้เฉพาะงานที่ตัวเองถูก assign เท่านั้น
// (ดู docs/architecture/RBAC_Matrix.md Section 4.3 และ Section 5 ข้อ 8)
const SELF_SCOPED_ROLES: readonly string[] = ['ST', 'OT'];

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

  async create(dto: CreateTaskDto, actor: ActingUser): Promise<Task> {
    if (actor.role !== OPERATION_ROLE) {
      throw new ForbiddenException('สร้างงานได้เฉพาะ Role Operation เท่านั้น');
    }
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

  findAll(query: QueryTaskDto, actor: ActingUser): Promise<Task[]> {
    // ST/OT (ผู้ใช้ Mobile) เห็นเฉพาะงานตัวเอง — บังคับที่ Backend เสมอ ห้ามใช้ค่า
    // assignedTo จาก client (ดู RBAC_Matrix.md Section 5 ข้อ 8)
    const assignedTo = SELF_SCOPED_ROLES.includes(actor.role)
      ? actor.id
      : query.assignedTo;

    return this.prisma.task.findMany({
      where: { status: query.status, assignedTo },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, actor: ActingUser): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task || this.isHiddenFromActor(task, actor)) {
      // ST/OT ที่ไม่ใช่เจ้าของงาน: 404 แทน 403 เพื่อไม่เปิดเผยว่ามี record นี้อยู่
      // (IDOR Prevention Pattern ใน CLAUDE.md)
      throw new NotFoundException(`ไม่พบงาน id ${id}`);
    }
    return task;
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    actor: ActingUser,
  ): Promise<Task> {
    if (actor.role === OPERATION_ROLE) {
      await this.findOne(id, actor);
      // race condition: ระหว่าง findOne กับ update นี้ row อาจถูกลบไปพอดีจาก
      // request อื่น (rare) — Prisma โยน P2025 ("Record to update not found")
      // ในกรณีนั้น แปลงเป็น 404 แทนที่จะปล่อยเป็น 500 (pattern เดียวกับ
      // ConfigService.update/updateStatus)
      try {
        return await this.prisma.task.update({
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
      } catch (err) {
        if (
          err instanceof PrismaClientKnownRequestError &&
          err.code === 'P2025'
        ) {
          throw new NotFoundException(`ไม่พบงาน id ${id}`);
        }
        throw err;
      }
    }

    if (!SELF_SCOPED_ROLES.includes(actor.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขงาน');
    }

    if (this.touchesNonStatusField(dto)) {
      throw new ForbiddenException(
        'ST/OT แก้ได้เฉพาะ field status ของงานที่ตัวเองถูก assign เท่านั้น',
      );
    }

    // IDOR Prevention Pattern (CLAUDE.md): filter ด้วย assignedTo ตอน update แล้ว
    // เช็ค count === 0 -> 404 แทนที่จะ update() เปล่าๆ ที่ filter แค่ id
    const result = await this.prisma.task.updateMany({
      where: { id, assignedTo: actor.id },
      data: { status: dto.status },
    });
    if (result.count === 0) {
      throw new NotFoundException(`ไม่พบงาน id ${id}`);
    }
    return this.prisma.task.findUniqueOrThrow({ where: { id } });
  }

  private isHiddenFromActor(task: Task, actor: ActingUser): boolean {
    return (
      SELF_SCOPED_ROLES.includes(actor.role) && task.assignedTo !== actor.id
    );
  }

  private touchesNonStatusField(dto: UpdateTaskDto): boolean {
    return [
      dto.title,
      dto.description,
      dto.assignedTo,
      dto.deviceId,
      dto.dueDate,
    ].some((value) => value !== undefined);
  }
}
