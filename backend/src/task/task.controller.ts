import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ActionType, Task } from '@prisma/client';
import type { Request, Response } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateTaskNoteDto } from './dto/create-task-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { StartTaskDto } from './dto/start-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  ActingUser,
  TaskEventView,
  TaskService,
  TaskWithAssignee,
} from './task.service';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role, ipAddress: req.ip ?? null };
}

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  findAll(
    @Query() query: QueryTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Task[]> {
    return this.taskService.findAll(query, toActor(req));
  }

  @Post()
  create(
    @Body() dto: CreateTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Task> {
    return this.taskService.create(dto, toActor(req));
  }

  /**
   * docs/28 §5.1 — ช่างเริ่มงานกับกล่องเอง · 201 = สร้างใบใหม่, 200 = ใช้ใบเดิม
   * ที่ยังเปิดอยู่ · resource `field-task` (ST/OT) แยกจาก `POST /tasks` ของ
   * Operation ที่ระบุ `assignedTo` เป็นคนอื่นได้ (A ตอบ Q1 บน #382) · ประกาศ
   * ก่อน `:id` กันชน route
   */
  @Post('start')
  @UseGuards(PermissionGuard)
  @RequirePermission('field-task', ActionType.Create)
  async start(
    @Body() dto: StartTaskDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Task> {
    const { task, created } = await this.taskService.start(dto, toActor(req));
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return task;
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TaskWithAssignee> {
    return this.taskService.findOneWithAssignee(id, toActor(req));
  }

  /** Task Event History (issue #296) — timeline เรียงเวลาเก่าไปใหม่ */
  @Get(':id/events')
  findEvents(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TaskEventView[]> {
    return this.taskService.findEvents(id, toActor(req));
  }

  /** Task Event History (issue #296) — เพิ่มบันทึกที่ไม่เปลี่ยนสถานะ */
  @Post(':id/notes')
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskNoteDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TaskEventView> {
    return this.taskService.addNote(id, dto, toActor(req));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Task> {
    return this.taskService.update(id, dto, toActor(req));
  }
}
