import { IsUUID } from 'class-validator';

/** Body ของ `POST /devices/{deviceId}/confirm-firmware-install` — `firmwareId`
 * คือ id ของ Firmware (`uploadStatus: stored`, `approvalStatus: approved`)
 * ที่ช่างยืนยันว่าติดตั้งเข้าอุปกรณ์เครื่องนี้เสร็จแล้วจริง (issue #181)
 *
 * **client เป็นคนส่ง `firmwareId` มา — endpoint นี้ไม่ผูกกับ Task/Campaign ใดๆ**
 * (เช่นเดียวกับ `ApplyConfigDto.configId` — ไม่มี FK เชื่อม Task/Campaign ไป
 * Firmware ให้ derive อัตโนมัติได้ ช่างเลือกเองจากรายการ `GET /firmware`)
 * ตั้งใจไม่ผูกกับ Campaign เพราะ Campaign เป็นแค่ tracking/maintenance
 * ไม่ใช่เครื่องมือมอบหมายงานให้ช่าง (มติ 2026-09-14) */
export class ConfirmFirmwareInstallDto {
  @IsUUID()
  firmwareId!: string;
}
