import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ActionType,
  CampaignRollout,
  CampaignRolloutTarget,
} from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ActingUser } from './campaign.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CreateCampaignRolloutDto } from './dto/create-campaign-rollout.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role };
}

// Campaign Monitor (#22, แก้ไข 2026-09-24) — nested ใต้ /campaigns/{campaignId}
// เพราะ Rollout อยู่ในบริบทของกลุ่มเสมอ ใช้ resource `campaign` เดียวกับ
// campaign.controller.ts (ไม่ใช่ resource ใหม่ — สิทธิ์เดิมตาม RBAC_Matrix.md
// §2 แถว "Campaign Wizard"/"Campaign Monitor" ครอบคลุมอยู่แล้ว: Operation =
// C, R, A · role อื่นทั้งหมด = R)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('campaigns/:campaignId/rollouts')
export class CampaignRolloutController {
  constructor(private readonly rolloutService: CampaignRolloutService) {}

  @Get()
  @RequirePermission('campaign', ActionType.Read)
  findAll(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<CampaignRollout[]> {
    return this.rolloutService.findAll(campaignId);
  }

  @Post()
  @RequirePermission('campaign', ActionType.Create)
  create(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: CreateCampaignRolloutDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CampaignRollout> {
    return this.rolloutService.create(campaignId, dto, toActor(req));
  }

  @Get(':id')
  @RequirePermission('campaign', ActionType.Read)
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignRollout> {
    return this.rolloutService.findOne(id);
  }

  // ผลต่อเครื่อง (Campaign Monitor #22 — failure rate จริง) — สิทธิ์เดียวกับ
  // ดู Rollout เอง
  @Get(':id/targets')
  @RequirePermission('campaign', ActionType.Read)
  findTargets(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignRolloutTarget[]> {
    return this.rolloutService.findTargets(id);
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
  ): Promise<CampaignRollout> {
    return this.rolloutService.approve(id, toActor(req));
  }

  @Post(':id/reject')
  @RequirePermission('campaign', ActionType.Approve)
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CampaignRollout> {
    return this.rolloutService.reject(id, toActor(req));
  }
}
