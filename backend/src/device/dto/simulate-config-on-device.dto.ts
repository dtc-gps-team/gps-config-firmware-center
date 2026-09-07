import { IsUUID } from 'class-validator';

/**
 * Body ของ `POST /devices/{deviceId}/simulate-config` — `configId` คือ id ของ
 * Config (สถานะ `approved`/`synced`) ที่ช่างหน้างานจะเช็คความพร้อมก่อนกด
 * `applyConfigToDevice` จริง `Config.id` เป็น uuid
 *
 * แยกคลาสจาก `ApplyConfigDto` (แม้ shape เหมือนกันตอนนี้) เพื่อไม่ผูก 2
 * endpoint เข้าด้วยกัน — ถ้าอันใดอันหนึ่งต้องเพิ่ม field ทีหลังจะไม่กระทบอีกอัน
 */
export class SimulateConfigOnDeviceDto {
  @IsUUID()
  configId!: string;
}
