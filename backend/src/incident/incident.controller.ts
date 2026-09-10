import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ActionType, Incident } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { QueryIncidentDto } from './dto/query-incident.dto';
import { IncidentService } from './incident.service';

// Incident module (read-only rollout — Sprint 2):
//   GET /incidents      — list + filter · ทุก Role
//   GET /incidents/:id  — detail 1 รายการ · ทุก Role
//
// resource `incidents` (พหูพจน์ ตั้งชื่อตาม path — mirror `devices`/`tasks`/
// `notifications`) action `Read` · RBAC_Matrix.md §2 แถว "Incident & Rollback"
// = R ทุก Role (คอลัมน์ SW/Operation/ST/OT/Auditor/Admin/SuperAdmin ทั้งหมดมี R)
// · grant seed เพิ่มใน prisma/seed.ts รอบนี้
//
// **ยังไม่มี** Create/Update/Rollback endpoint — Create ยังเป็นแค่ auto จาก
// config-sync-writer (`createFromSyncFailure`) · Update (ST แก้เชิงเทคนิค,
// Operation สั่ง Rollback) รอ Rollback flow จริง (Sprint Checklist แถว 28)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('incidents')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  @Get()
  @RequirePermission('incidents', ActionType.Read)
  findAll(@Query() query: QueryIncidentDto): Promise<Incident[]> {
    return this.incidentService.findAllIncidents(query);
  }

  @Get(':id')
  @RequirePermission('incidents', ActionType.Read)
  findOne(@Param('id') id: string): Promise<Incident> {
    return this.incidentService.findIncidentById(id);
  }
}
