import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

/** Body ของ `POST /config/{configId}/override` (issue #185) — ST แก้ค่าบาง
 * field ของ Config ที่ `approved`/`synced` แล้ว โดยไม่ผ่าน Approval Center
 * ปกติ (ดู `OVERRIDABLE_CONFIG_STATUSES`)
 *
 * `fields` เป็น **partial update** — ใส่แค่ field ที่ต้องการแก้ ไม่ต้องส่ง
 * ทั้งชุดเหมือน `UpdateConfigDto` (ต่างจาก create/update ปกติที่แทนที่ทั้ง
 * object) — ทุก key ต้อง `stOverridable: true` ตาม `ConfigFieldDefinition`
 * ที่เกี่ยวข้อง (เช็คที่ `ConfigDefinitionService.validateOverridableFields`)
 *
 * `reason` บังคับกรอกเสมอ — ตาม `GPS_Config_Firmware_Center_Design.pdf`
 * §19 ข้อ 24: "ทุกการ Override ต้องมีผู้ดำเนินการ เหตุผล และ Audit Log"
 * (ผู้ดำเนินการ = actor จาก JWT, Audit Log = บังคับเขียนทุกครั้งอยู่แล้ว
 * ตาม RBAC_Matrix.md กฎข้อ 3 — เหลือแค่ "เหตุผล" ที่ต้องบังคับรับจาก client) */
export class OverrideConfigDto {
  @IsObject()
  fields!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
