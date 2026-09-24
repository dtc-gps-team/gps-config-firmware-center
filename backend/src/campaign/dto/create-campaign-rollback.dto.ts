import { ArrayUnique, IsArray, IsOptional, IsString } from 'class-validator';

/**
 * Body ของ `POST /campaigns/{campaignId}/rollouts/{id}/rollback` (Incident &
 * Rollback #28, แก้ไข 2026-09-24) — mirror `CreateCampaignRolloutDto` แต่ไม่
 * มี payloadType/configId/firmwareId เพราะระบบหาของเก่ามาใช้เองจากรอบก่อน
 * หน้าที่สำเร็จล่าสุด (ดู `CampaignRolloutService.rollback()`)
 *
 * `excludeDeviceIds` ไม่ต้องส่งมา = rollback ทุกเครื่องที่เคยได้รับ payload
 * ของรอบนี้สำเร็จ (`CampaignRolloutTarget.status = success`)
 */
export class CreateCampaignRollbackDto {
  /** `Device.deviceId` ที่ต้องการเอาออกจากรอบ rollback นี้ (เช่นแก้ไขด้วย
   * มือไปแล้ว หรือปลดระวางไปแล้ว) — ทุกตัวต้องเป็นเครื่องที่ได้รับ payload
   * ของรอบที่มีปัญหาสำเร็จจริง ไม่งั้น 400 */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  excludeDeviceIds?: string[];
}
