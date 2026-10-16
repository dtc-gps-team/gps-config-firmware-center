import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const JOB_RESULTS = ['success', 'failed'] as const;
export type JobResult = (typeof JOB_RESULTS)[number];

/** ความยาวสูงสุดของข้อความจากอุปกรณ์ (docs/19 §4.2) — เก็บลง
 * `CampaignRolloutTarget.resultDetail` ที่ Operation เห็นบนหน้า Rollout */
export const MAX_JOB_RESULT_DETAIL_LENGTH = 500;

/** body ของ `POST /device-sync/{deviceId}/jobs/{jobId}/result` */
export class ReportJobResultDto {
  @IsIn(JOB_RESULTS)
  result!: JobResult;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_JOB_RESULT_DETAIL_LENGTH)
  detail?: string;
}
