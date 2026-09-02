import { Controller, Get, UseGuards } from '@nestjs/common';
import { ActionType, ConfigFieldDefinition } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ConfigDefinitionService } from './config-definition.service';

// Config Definition Lookup (task #12, แผน Agile แถว 12) — module แยกตามแพทเทิร์น
// `config` module (controller + service + module) endpoint อ่านอย่างเดียว
// (`GET /config-definitions`) ยังไม่มี Create/Update/Delete — ตารางนี้ยังไม่มี
// use case จัดการผ่าน UI จริง แค่ให้ระบบ/ฟอร์ม query catalog ไปใช้
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
  findAll(): Promise<ConfigFieldDefinition[]> {
    return this.configDefinitionService.findAll();
  }
}
