import type { LegacyConfigWrite } from './config-sync-writer.interface';

/**
 * แปลง `Config.fields` / `ConfigVersion.fields` (Json: ค่าเป็น string, number
 * หรือ boolean ตาม ConfigFieldDefinition) เป็น shape ที่ `LegacyConfigWrite.fields`
 * รับ (`Record<string, string | number>`): boolean -> "true"/"false", null และ
 * undefined ตัดทิ้ง · การ map ชื่อ field และรูปแบบค่าที่ระบบเดิมต้องการจริงเป็น
 * TBD ของ handoff (docs/07 §8) ตอน mock ขอแค่ serialize ได้
 *
 * แยกออกมาเป็นฟังก์ชันกลางเพราะมี 2 ที่ใช้: `ConfigService.approve()` (เขียนครั้ง
 * แรก) และ `IncidentService.retrySync()` (ลองเขียนใหม่จาก snapshot ของเวอร์ชัน)
 * ต้องแปลงเหมือนกันเป๊ะ ไม่งั้นค่าที่เขียนซ้ำจะต่างจากที่อนุมัติไว้
 */
export function toLegacyFields(fields: unknown): LegacyConfigWrite['fields'] {
  const out: Record<string, string | number> = {};
  if (fields != null && typeof fields === 'object') {
    for (const [key, value] of Object.entries(
      fields as Record<string, unknown>,
    )) {
      if (value === null || value === undefined) continue;
      out[key] =
        typeof value === 'number' || typeof value === 'string'
          ? value
          : typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
    }
  }
  return out;
}
