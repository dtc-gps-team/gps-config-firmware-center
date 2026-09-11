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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ActionType, Firmware } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { SimulateFirmwareDto } from './dto/simulate-firmware.dto';
import { UpdateFirmwareCompatibilityDto } from './dto/update-firmware-compatibility.dto';
import { ActingUser, FirmwareService } from './firmware.service';
import type { SimulationResult } from './firmware-simulator';

/** ไฟล์ Firmware อาจใหญ่กว่า Config JSON มาก (binary ของ tracker) — 50MB
 * ครอบคลุม firmware กล่อง GPS ทั่วไปที่มักไม่เกินหลัก MB (ตกลงกับ paveekornk
 * เอง 2026-09-11 ไม่มีสเปกจริงจากผู้ผลิตกล่องมาอ้างอิง ปรับได้ถ้าเจอไฟล์ใหญ่กว่านี้จริง) */
const UPLOAD_FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Sprint 3 #23 (Firmware Repository) — RBAC_Matrix.md §2 แถว "Firmware
// Repository": SW = C, R, U · role อื่นทั้งหมด = R · resource `firmware`
// แยกจาก `firmware-simulation` (mirror `config`/`config-simulation`) เพราะ
// simulate ไม่เปิดให้ Auditor/Admin ที่มีแค่ firmware.Read เรียกได้
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('firmware')
export class FirmwareController {
  constructor(private readonly firmwareService: FirmwareService) {}

  @Get()
  @RequirePermission('firmware', ActionType.Read)
  findAll(): Promise<Firmware[]> {
    return this.firmwareService.findAll();
  }

  @Post()
  @RequirePermission('firmware', ActionType.Create)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT_BYTES },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('version') version: string | undefined,
    @Body('deviceModel') deviceModel: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<Firmware> {
    return this.firmwareService.upload(
      file,
      version,
      deviceModel,
      toActor(req),
    );
  }

  @Get(':id')
  @RequirePermission('firmware', ActionType.Read)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Firmware> {
    return this.firmwareService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('firmware', ActionType.Update)
  updateCompatibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFirmwareCompatibilityDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Firmware> {
    return this.firmwareService.updateCompatibility(id, dto, toActor(req));
  }

  @Post(':id/simulate')
  @RequirePermission('firmware-simulation', ActionType.Read)
  @HttpCode(HttpStatus.OK)
  simulate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulateFirmwareDto,
  ): Promise<SimulationResult> {
    return this.firmwareService.simulate(id, dto.deviceModel);
  }
}
