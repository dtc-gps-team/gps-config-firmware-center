import { IsUUID } from 'class-validator';

/** Body ของ `POST /devices/{deviceId}/apply-config` — ช่างเลือก Config ที่จะ
 * ใส่เข้าอุปกรณ์เครื่องนี้ (`configId` มาจาก Task ที่ช่างเปิดอยู่ — ดู
 * Task.deviceId / Task.configId ฝั่ง Mobile) `Config.id` เป็น uuid */
export class ApplyConfigDto {
  @IsUUID()
  configId!: string;
}
