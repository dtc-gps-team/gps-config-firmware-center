import { CampaignStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { CAMPAIGN_STATUSES } from '../campaign-status';

export class QueryCampaignDto {
  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES)
  status?: CampaignStatus;
}
