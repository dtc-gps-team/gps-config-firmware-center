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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ActionType, Config } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ActingUser, ConfigService } from './config.service';
import type { SimulationResult } from './device-simulator';
import { CreateConfigDto } from './dto/create-config.dto';
import { QueryConfigDto } from './dto/query-config.dto';
import { UpdateConfigDto } from './dto/update-config.dto';

/** เพดานขนาดไฟล์ import — ไฟล์ Config JSON เล็กมาก (ไม่กี่ field) 1MB เหลือเฟือ
 * และกันไม่ให้มีคนอัปโหลดไฟล์ใหญ่ผิดปกติเข้ามา — ไฟล์เกิน limit นี้ Nest แปลง
 * MulterError('LIMIT_FILE_SIZE') เป็น PayloadTooLargeException (413) ให้เอง
 * อัตโนมัติอยู่แล้ว (ดู @nestjs/platform-express multer.utils.ts) ไม่ต้องดัก
 * เพิ่ม — ยืนยันพฤติกรรมนี้ด้วย integration test แล้ว */
const IMPORT_FILE_SIZE_LIMIT_BYTES = 1 * 1024 * 1024;

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Stage 1-3 (issue #26) — CRUD พื้นฐาน (list/create/get/update/delete) +
// Import จากไฟล์ JSON + Simulate ยังไม่มี decide/approve/reject (ดู
// 04_Phase1_A_ConfigWorkflow.md — ทำเป็น Stage 4 แยกทีหลัง)
//
// DELETE ใช้ action Update เดิม (ไม่มี ActionType.Delete ใน enum) — ตัดสินใจ
// ไว้ตอนแก้ schema follow-up ก่อน #26 ดูเหตุผลเต็มๆ ใน PR #44 description
// (หัวข้อ "openapi.yaml เพิ่ม GET/PUT/DELETE /config/{configId}"):
// https://github.com/dtc-gps-team/gps-config-firmware-center/pull/44
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

  // Stage 2 (#26) — Import Config จากไฟล์ JSON เข้า flow เดียวกับ createConfig
  // เป๊ะๆ (ดู ConfigService.importFromJson) สิทธิ์ใช้ resource "config" action
  // Create ตัวเดียวกับสร้างผ่านฟอร์ม (RBAC_Matrix.md แถว "Config Import จาก
  // ไฟล์ (JSON)" ก็ระบุแค่ C เหมือนกัน — ไม่ต้อง grant เพิ่ม)
  @Post('import')
  @RequirePermission('config', ActionType.Create)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IMPORT_FILE_SIZE_LIMIT_BYTES },
    }),
  )
  importConfig(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('format') format: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<Config> {
    return this.configService.importFromJson(file, format, toActor(req));
  }

  @Get(':id')
  @RequirePermission('config', ActionType.Read)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Config> {
    return this.configService.findOne(id);
  }

  // Stage 3 (#26) — ทดสอบกับ Device Simulator (dry-run, ไม่แตะ status)
  // resource แยกจาก 'config' ธรรมดาโดยตั้งใจ (ดู prisma/seed.ts): SW/Operation/
  // ST/OT ต้องเรียก endpoint นี้ได้ทั้งคู่ แต่ Auditor/Admin ที่มี config.Read
  // อยู่แล้ว (ไว้แค่ดูรายการ/รายละเอียด) ไม่ควรเรียก simulate ได้ตาม
  // RBAC_Matrix.md ตาราง 4.1 — ถ้าใช้ 'config'+Read ร่วมกับ endpoint อื่นจะ
  // เผลอเปิดให้ Auditor/Admin เรียกได้ไปด้วยโดยไม่ตั้งใจ
  @Post(':id/simulate')
  @RequirePermission('config-simulation', ActionType.Read)
  @HttpCode(HttpStatus.OK)
  simulate(@Param('id', ParseUUIDPipe) id: string): Promise<SimulationResult> {
    return this.configService.simulate(id);
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
