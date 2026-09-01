import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType, Config } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ActingUser, ConfigService } from './config.service';
import { CreateConfigDto } from './dto/create-config.dto';
import { QueryConfigDto } from './dto/query-config.dto';
import { UpdateConfigDto } from './dto/update-config.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Stage 1 (issue #26) — เฉพาะ CRUD พื้นฐาน (list/create/get/update/delete)
// ยังไม่มี import/simulate/approve/reject (ดู 04_Phase1_A_ConfigWorkflow.md
// Section 2.4 — ทำเป็น Stage แยกทีหลัง)
//
// DELETE ใช้ action Update เดิม (ไม่มี ActionType.Delete ใน enum) — ตัดสินใจ
// ไว้แล้วตอนแก้ schema follow-up ก่อน #26 (ดู PR schema follow-up)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @RequirePermission('config', ActionType.Read)
  findAll(@Query() query: QueryConfigDto): Promise<Config[]> {
    return this.configService.findAll(query);
  }

  @Post()
  @RequirePermission('config', ActionType.Create)
  create(
    @Body() dto: CreateConfigDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Config> {
    return this.configService.create(dto, toActor(req));
  }

  @Get(':id')
  @RequirePermission('config', ActionType.Read)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Config> {
    return this.configService.findOne(id);
  }

  @Put(':id')
  @RequirePermission('config', ActionType.Update)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConfigDto,
  ): Promise<Config> {
    return this.configService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('config', ActionType.Update)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.configService.remove(id);
  }
}
