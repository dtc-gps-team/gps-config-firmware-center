import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ActionType,
  Campaign,
  CampaignRollout,
  CampaignTarget,
} from '@prisma/client';
import { Request } from 'express';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CampaignRolloutService } from './campaign-rollout.service';
import { ActingUser, CampaignService } from './campaign.service';
import {
  FIELD_APPLY_RETRY_SETTINGS,
  type FieldApplyRetrySettings,
} from './field-apply-retry.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { QueryCampaignRolloutDto } from './dto/query-campaign-rollout.dto';
import {
  AddCampaignTargetsDto,
  UpdateCampaignDto,
} from './dto/update-campaign.dto';

/** Request ที่ผ่าน JwtAuthGuard จะมี user อยู่เสมอ */
type AuthenticatedRequest = Request & { user: JwtPayload };

function toActor(req: AuthenticatedRequest): ActingUser {
  return { id: req.user.sub, role: req.user.role, ipAddress: req.ip ?? null };
}

// Sprint 3 #21 (Campaign Wizard) — RBAC_Matrix.md §2 แถว "Campaign Wizard":
// ConfigEngineer/ST/OT/Auditor/Admin/SuperAdmin = R (เดิม SW ก่อนแยก role —
// FirmwareEngineer/QAEngineer ไม่เกี่ยวกับ Campaign เลยจึงไม่มีสิทธิ์นี้),
// Operation = C, R (approve/reject ของ payload ย้ายไป
// `campaign-rollout.controller.ts` แล้ว — แก้ไข 2026-09-24)
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('campaigns')
export class CampaignController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly campaignRolloutService: CampaignRolloutService,
    @Inject(FIELD_APPLY_RETRY_SETTINGS)
    private readonly retrySettings: FieldApplyRetrySettings,
  ) {}

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

  // ข้าม Campaign ทุกกลุ่ม (Approval Center รวม Campaign Rollout, แก้ไข
  // 2026-09-24) — ต้องประกาศ**ก่อน** `findOne(':id')` เสมอ ไม่งั้น Express/Nest
  // จะจับคำว่า "rollouts" เป็นค่า `:id` แทน (route แบบ static ต้องมาก่อน
  // dynamic param เมื่อ path ชนกัน)
  @Get('rollouts')
  @RequirePermission('campaign', ActionType.Read)
  findAllRollouts(
    @Query() query: QueryCampaignRolloutDto,
  ): Promise<CampaignRollout[]> {
    return this.campaignRolloutService.findAllAcrossCampaigns(query.status);
  }

  // จำนวนครั้งสูงสุดของการลองส่งใหม่อัตโนมัติ (รวมครั้งแรก) ตามค่า `FIELD_APPLY_MAX_ATTEMPTS` ของ backend
  // ให้เว็บเขียนป้าย "รอบ N/M" และข้อความสวิตช์ตามค่าจริง ไม่ฝังเลข 3 (docs/31 §7.6 W1) ·
  // static path ต้องมาก่อน `:id` เหมือน `rollouts` ด้านบน
  @Get('auto-retry-settings')
  @RequirePermission('campaign', ActionType.Read)
  getAutoRetrySettings(): { maxAttempts: number } {
    return { maxAttempts: this.retrySettings.maxAttempts };
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

  // แก้/ลบกลุ่มและสมาชิก — Operation เท่านั้น (resource `campaign` action
  // `Update`; ไม่มี action Delete ใน ActionType จึงใช้ Update ครอบการลบ เหมือน
  // `DELETE /config/{id}`) · SuperAdmin ผ่านด้วย bypass ใน PermissionGuard
  @Patch(':id')
  @RequirePermission('campaign', ActionType.Update)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Campaign> {
    return this.campaignService.update(id, dto, toActor(req));
  }

  @Delete(':id')
  @RequirePermission('campaign', ActionType.Update)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.campaignService.remove(id, toActor(req));
  }

  @Post(':id/targets')
  @RequirePermission('campaign', ActionType.Update)
  addTargets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCampaignTargetsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CampaignTarget[]> {
    return this.campaignService.addTargets(id, dto, toActor(req));
  }

  @Delete(':id/targets/:deviceId')
  @RequirePermission('campaign', ActionType.Update)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTarget(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId') deviceId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.campaignService.removeTarget(id, deviceId, toActor(req));
  }
}
