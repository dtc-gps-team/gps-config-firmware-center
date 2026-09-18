import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ActingUser,
  ManagedUser,
  UserService,
  UserSummary,
} from './user.service';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// user module:
//   GET   /users            — ทุก role ที่ login แล้ว (ไม่มี PermissionGuard,
//                              dropdown "เจาะจงผู้อนุมัติ" — ดู user.service.ts)
//   GET   /users/managed     — User / Role Management (Admin เท่านั้น, resource
//                              `user-management` action Read)
//   POST  /users             — สร้างบัญชีทั่วไปใหม่ (resource `user-management`
//                              action Create)
//   PATCH /users/{id}        — แก้ role/isActive (resource `user-management`
//                              action Update)
//
// `/users/managed` เป็น static path ประกาศไว้คู่กับ `GET /users` เฉยๆ (คนละ
// method/path ไม่ชนกัน) — จงใจแยกจาก `GET /users` เดิมแทนที่จะใช้ query param
// เพราะสิทธิ์ต่างกันจริง (ไม่มี guard เทียบกับ PermissionGuard) mirror
// pattern แยก resource ที่ config/firmware ใช้อยู่แล้ว (เช่น `config` vs
// `config-decision`) ไม่ใช่ if-role ในเซอร์วิสเดียว
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Query() query: QueryUserDto): Promise<UserSummary[]> {
    return this.userService.list(query);
  }

  @Get('managed')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user-management', ActionType.Read)
  listManaged(): Promise<ManagedUser[]> {
    return this.userService.listManaged();
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user-management', ActionType.Create)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ManagedUser> {
    return this.userService.create(dto, toActor(req));
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user-management', ActionType.Update)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ManagedUser> {
    return this.userService.update(id, dto, toActor(req));
  }
}
