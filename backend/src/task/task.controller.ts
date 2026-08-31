import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Task } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ActingUser, TaskService } from './task.service';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
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

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Task> {
    return this.taskService.findOne(id, toActor(req));
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
