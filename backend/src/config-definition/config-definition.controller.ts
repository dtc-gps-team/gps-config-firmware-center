import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  ConfigDefinitionService,
  ConfigFieldDefinitionWithSupport,
} from './config-definition.service';
import { CreateConfigDefinitionDto } from './dto/create-config-definition.dto';

// Config Definition Lookup (task #12, แผน Agile แถว 12) — module แยกตามแพทเทิร์น
// `config` module (controller + service + module)
//
// `POST /config-definitions` (ใหม่ — ตัดสินใจร่วมกับ B และพี่เลี้ยง 2569-09):
// SW สร้าง field definition เองได้เลย ไม่ต้องผ่านอนุมัติ เพราะ field ที่มี
// ปัญหาจริงจะโดนจับตอนเอาไปสร้าง Config Template แล้วเข้า simulate/approve
// อยู่ดี — ดู RBAC_Matrix.md changelog
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('config-definitions')
export class ConfigDefinitionController {
  constructor(
    private readonly configDefinitionService: ConfigDefinitionService,
  ) {}

  // resource `config-definition` action Read — เปิดให้ SW/Operation/ST/OT
  // (ทุก role ที่ทำงานกับ Config) เพราะเป็นแค่ catalog ไม่ใช่ข้อมูลอ่อนไหว
  // แพทเทิร์นเดียวกับ `config-simulation` ที่เพิ่งเพิ่มใน PR #49 (ดู prisma/seed.ts)
  @Get()
  @RequirePermission('config-definition', ActionType.Read)
  findAll(): Promise<ConfigFieldDefinitionWithSupport[]> {
    return this.configDefinitionService.findAll();
  }

  // resource `config-definition` action Create — เฉพาะ SW (คนเดียวที่รู้ว่า
  // ต้องสร้าง field อะไรใหม่บ้างตามที่ใช้จริง) ไม่มีขั้นตอนอนุมัติ
  @Post()
  @RequirePermission('config-definition', ActionType.Create)
  create(
    @Body() dto: CreateConfigDefinitionDto,
  ): Promise<ConfigFieldDefinitionWithSupport> {
    return this.configDefinitionService.create(dto);
  }
}
