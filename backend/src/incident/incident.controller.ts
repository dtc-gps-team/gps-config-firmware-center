import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType, Incident } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { DecideIncidentDto } from './dto/decide-incident.dto';
import { QueryIncidentDto } from './dto/query-incident.dto';
import {
  ActingUser,
  DecideIncidentResult,
  IncidentService,
} from './incident.service';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ — mirror device.controller.ts */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Incident module:
//   GET  /incidents             — list + filter · ทุก Role (self-scope
//                                field report สำหรับ ST/OT — ดู incident.service.ts)
//   GET  /incidents/:id         — detail 1 รายการ · ทุก Role (self-scope เหมือนกัน)
//   POST /incidents             — ST/OT แจ้งปัญหาที่เจอกับอุปกรณ์ (issue #236)
//   POST /incidents/:id/decide  — Operation ตัดสินใจ field report (issue #236)
//
// resource `incidents` (พหูพจน์ ตั้งชื่อตาม path — mirror `devices`/`tasks`/
// `notifications`) action `Read` · RBAC_Matrix.md §2 แถว "Incident & Rollback"
// = R ทุก Role · action `Create` ใหม่ (ST/OT เท่านั้น) · action `Approve`
// ใหม่สำหรับ decide (Operation เท่านั้น — **ไม่สร้าง action ใหม่** เพราะ
// `ActionType` เป็น Prisma enum จริง ทุกจุดที่ Operation ตัดสินใจใช้ `Approve`
// ตัวเดียวกันอยู่แล้ว ดู comment เหนือ `IncidentService.decide()`)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('incidents')
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  @Get()
  @RequirePermission('incidents', ActionType.Read)
  findAll(
    @Query() query: QueryIncidentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Incident[]> {
    return this.incidentService.findAllIncidents(query, toActor(req));
  }

  @Get(':id')
  @RequirePermission('incidents', ActionType.Read)
  findOne(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Incident> {
    return this.incidentService.findIncidentById(id, toActor(req));
  }

  @Post()
  @RequirePermission('incidents', ActionType.Create)
  create(
    @Body() dto: CreateIncidentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Incident> {
    return this.incidentService.createFieldReport(dto, toActor(req));
  }

  @Post(':id/decide')
  @RequirePermission('incidents', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  decide(
    @Param('id') id: string,
    @Body() dto: DecideIncidentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<DecideIncidentResult> {
    return this.incidentService.decide(id, dto, toActor(req));
  }
}
