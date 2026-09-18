import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActionType, Campaign } from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ActingUser, CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { QueryCampaignDto } from './dto/query-campaign.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Sprint 3 #21 (Campaign Wizard) — RBAC_Matrix.md §2 แถว "Campaign Wizard":
// ConfigEngineer/ST/OT/Auditor/Admin/SuperAdmin = R (เดิม SW ก่อนแยก role —
// FirmwareEngineer/QAEngineer ไม่เกี่ยวกับ Campaign เลยจึงไม่มีสิทธิ์นี้),
// Operation = C, R, U (ยังไม่มี U ใน module นี้ — รอ Campaign Monitor แถวที่
// 22 แยกต่างหาก)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  @RequirePermission('campaign', ActionType.Read)
  findAll(@Query() query: QueryCampaignDto): Promise<Campaign[]> {
    return this.campaignService.findAll(query);
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

  // Campaign Approval (แก้ครั้งที่ 39) — resource `campaign` action `Approve`
  // เดียวกันทั้ง approve/reject (mirror ConfigController/FirmwareController)
  // — Operation เท่านั้น (ตัว SelfApprovalGuard/SoD check อยู่ใน service
  // เพราะต้องรู้ createdBy ของ resource ก่อนตัดสิน ทำเป็น decorator guard
  // ธรรมดาไม่ได้)
  @Post(':id/approve')
  @RequirePermission('campaign', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Campaign> {
    return this.campaignService.approve(id, toActor(req));
  }

  @Post(':id/reject')
  @RequirePermission('campaign', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Campaign> {
    return this.campaignService.reject(id, toActor(req));
  }
}
