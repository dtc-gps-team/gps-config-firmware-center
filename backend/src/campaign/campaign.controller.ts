import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType, Campaign, CampaignTarget } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ActingUser, CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Sprint 3 #21 (Campaign Wizard) — RBAC_Matrix.md §2 แถว "Campaign Wizard":
// ConfigEngineer/ST/OT/Auditor/Admin/SuperAdmin = R (เดิม SW ก่อนแยก role —
// FirmwareEngineer/QAEngineer ไม่เกี่ยวกับ Campaign เลยจึงไม่มีสิทธิ์นี้),
// Operation = C, R (approve/reject ของ payload ย้ายไป
// `campaign-rollout.controller.ts` แล้ว — แก้ไข 2026-09-24)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  @RequirePermission('campaign', ActionType.Read)
  findAll(): Promise<Campaign[]> {
    return this.campaignService.findAll();
  }

  @Post()
  @RequirePermission('campaign', ActionType.Create)
  create(
    @Body() dto: CreateCampaignDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Campaign> {
    return this.campaignService.create(dto, toActor(req));
  }

  @Get(':id')
  @RequirePermission('campaign', ActionType.Read)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Campaign> {
    return this.campaignService.findOne(id);
  }

  // สมาชิกกลุ่ม (Campaign Monitor #22 — แสดงรายชื่ออุปกรณ์เป้าหมายจริง แก้ไข
  // 2026-09-24) — สิทธิ์เดียวกับดู Campaign เอง
  @Get(':id/targets')
  @RequirePermission('campaign', ActionType.Read)
  findTargets(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignTarget[]> {
    return this.campaignService.findTargets(id);
  }
}
