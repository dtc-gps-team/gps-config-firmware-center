import { CampaignRolloutStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { CAMPAIGN_ROLLOUT_STATUSES } from '../campaign-rollout-status';

/** Query ของ `GET /campaigns/rollouts` (ข้าม Campaign ทุกกลุ่ม) — ใช้กับ
 * Approval Center (`?status=pending_approval`) เป็นหลัก — mirror
 * `QueryConfigDto` ที่ `listConfigs` ใช้กรอง `status` แบบเดียวกัน */
export class QueryCampaignRolloutDto {
  @IsOptional()
  @IsIn(CAMPAIGN_ROLLOUT_STATUSES)
  status?: CampaignRolloutStatus;
}
