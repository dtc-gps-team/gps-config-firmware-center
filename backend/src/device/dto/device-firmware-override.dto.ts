import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body ของ `POST /devices/{deviceId}/firmware-override` (Sprint 3 แถวที่ 24)
 * — ST ขอให้อุปกรณ์เครื่องนี้เครื่องเดียวติดตั้ง `firmwareId` ที่ระบุได้ แม้จะ
 * ไม่ตรงกับ Campaign Rollout (Firmware) ที่ `active` กำหนดไว้ก็ตาม (ดู comment
 * เหนือ `DeviceService.confirmFirmwareInstall()`) mirror
 * `DeviceConfigOverrideDto` ทุกประการ ต่างกันแค่ไม่มี `fields` เพราะ Firmware
 * ไม่ใช่ key-value ที่ override บางส่วนได้ — มีแค่ "อยากได้ firmware ตัวไหน"
 *
 * `reason` บังคับกรอกเสมอเหมือน `DeviceConfigOverrideDto` */
export class DeviceFirmwareOverrideDto {
  @IsUUID()
  firmwareId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
