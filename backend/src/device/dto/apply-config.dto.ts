import { IsUUID } from 'class-validator';

/** Body ของ `POST /devices/{deviceId}/apply-config` — `configId` คือ id ของ
 * Config (สถานะ `approved`/`synced`) ที่จะใส่เข้าอุปกรณ์เครื่องนี้ `Config.id`
 * เป็น uuid
 *
 * **client เป็นคนส่ง `configId` มา — endpoint นี้ไม่ผูกกับ Task/Device ใดๆ**
 * กลไกที่ Mobile จะได้ `configId` มาตอนสร้างจอ Confirm Install ยังไม่ได้ออกแบบ
 * (`Task` ตอนนี้มีแค่ `deviceId` ไม่มี `configId`, `Config` ผูกแค่กับ
 * `deviceModel`/`protocol` ไม่มี FK ไป device/task) — เป็น open question ที่
 * คุยกับ kittiphong (B) ต่อบน PR #81 / มีตติ้ง #32 ก่อนเริ่ม Mobile PR */
export class ApplyConfigDto {
  @IsUUID()
  configId!: string;
}
