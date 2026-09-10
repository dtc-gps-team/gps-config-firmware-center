import { IncidentStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { INCIDENT_STATUSES } from '../incident-status';

/**
 * Query ของ `GET /incidents` (read-only rollout — Sprint 2) — ทุก filter
 * optional ไม่ส่งอะไรมา = คืนทุกรายการ เรียงตาม `createdAt desc` (ใหม่สุดก่อน)
 * · mirror `QueryDeviceDto`
 */
export class QueryIncidentDto {
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: IncidentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  relatedConfigId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  relatedFirmwareId?: string;
}
