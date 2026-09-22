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
  UseGuards,
} from '@nestjs/common';
import { ActionType, DeviceModel } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateDeviceModelDto } from './dto/create-device-model.dto';
import { UpdateDeviceModelDto } from './dto/update-device-model.dto';
import { DeviceModelService } from './device-model.service';

// device-model module (issue #209, docs/15):
//   GET   /device-models       — ทุก role ที่ login แล้ว (ไม่มี PermissionGuard
//                                 mirror `GET /users` — ไม่ใช่ข้อมูลอ่อนไหว)
//   GET   /device-models/{id}  — เหมือนกัน
//   POST  /device-models       — Admin/SuperAdmin เท่านั้น (resource
//                                 `device-model` action Create)
//   PATCH /device-models/{id}  — เหมือนกัน (action Update)
@Controller('device-models')
export class DeviceModelController {
  constructor(private readonly deviceModelService: DeviceModelService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(): Promise<DeviceModel[]> {
    return this.deviceModelService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DeviceModel> {
    return this.deviceModelService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('device-model', ActionType.Create)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDeviceModelDto): Promise<DeviceModel> {
    return this.deviceModelService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('device-model', ActionType.Update)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceModelDto,
  ): Promise<DeviceModel> {
    return this.deviceModelService.update(id, dto);
  }
}
