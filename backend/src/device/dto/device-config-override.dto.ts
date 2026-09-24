import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

/** Body ของ `POST /devices/{deviceId}/config-override` (issue #223) — ST แก้ค่า
 * บาง field ของ Config ปัจจุบันของ**อุปกรณ์เครื่องนี้เครื่องเดียว** โดยไม่ผ่าน
 * Approval Center ปกติ — mirror `OverrideConfigDto` (`config-override/dto/`,
 * issue #185) ทุกประการ ต่างกันแค่ scope: ตัวนี้ไม่กระทบอุปกรณ์อื่นที่ใช้
 * Config เดียวกัน (ดู comment เหนือ `model DeviceConfigOverride` ใน
 * schema.prisma)
 *
 * `fields` เป็น partial update เหมือนเดิม — ทุก key ต้อง `stOverridable: true`
 * ตาม `ConfigFieldDefinition` ของ deviceModel/protocol ของอุปกรณ์นี้ (เช็คที่
 * `ConfigDefinitionService.validateOverridableFields`, reuse ตัวเดียวกับ
 * `config-override` เดิม) `reason` บังคับกรอกเสมอเหมือนเดิม */
export class DeviceConfigOverrideDto {
  @IsObject()
  fields!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
