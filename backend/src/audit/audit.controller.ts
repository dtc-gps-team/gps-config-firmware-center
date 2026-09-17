import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActionType, AuditLog } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

// Audit module (read-only — Sprint 3 #27):
//   GET /audit-logs — list + filter (userId/auditModule/action) · ทุก Role
//   ยกเว้น ConfigEngineer/FirmwareEngineer/QAEngineer (เดิม SW ก่อนแยก role —
//   RBAC_Matrix.md Section 2 แถว "Audit Log" — ทั้ง 3 คอลัมน์เป็น "-")
//
// resource `audit-logs` (พหูพจน์ ตั้งชื่อตาม path — mirror `devices`/`tasks`/
// `incidents`) action `Read` · grant seed: Operation/ST/OT/Auditor/Admin
// (SuperAdmin ได้อัตโนมัติจากการ copy สิทธิ์ Admin ใน seed.ts)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('audit-logs', ActionType.Read)
  findAll(@Query() query: QueryAuditLogDto): Promise<AuditLog[]> {
    return this.auditService.findAll(query);
  }
}
