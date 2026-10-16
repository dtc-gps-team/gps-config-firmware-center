import { IsUUID } from 'class-validator';

/** Query ของ `GET /campaigns/{campaignId}/rollouts/device-values` (docs/17
 * ข้อ 3.6) — Config แม่แบบที่กำลังจะใช้สร้าง Rollout */
export class QueryRolloutDeviceValuesDto {
  @IsUUID()
  configId!: string;
}
