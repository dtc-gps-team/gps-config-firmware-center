/**
 * แปลง `settings` ซ้อนชั้น (format ที่ Server กลางของพี่เลี้ยงรับ/ส่งจริง — ดู
 * `putDeviceConfig()` ใน `central-device/central-device.client.ts` ที่ส่งด้วย
 * wrapper key นี้) ให้เป็น `fields` คีย์แบบมีจุดที่ `Config.fields` เก็บจริงใน
 * ระบบเรา — ตัวกลับของการซ้อนชั้นใน `buildCentralSettings()`
 * (`central-device/central-config.ts`) แต่ตั้งใจไม่แปลงชนิดค่า (coerce) เพราะ
 * จุดนี้แค่แปลง "รูปร่าง" ของไฟล์ import ก่อนเข้า Semantic Validation
 * (`ConfigDefinitionService.validateFields()` ที่ `create()` เรียกอยู่แล้ว)
 * ที่ตรวจชนิด/ค่าที่อนุญาตเองอีกชั้น — รุ่นอุปกรณ์ที่ไม่มี key แบบมีจุด (เช่น
 * GT06N/SMARTEYEPLUS — `APN1`, `MTYP`) ผ่านฟังก์ชันนี้แบบไม่มีผล (no-op) เพราะ
 * ไม่มี key ไหนซ้อนชั้นอยู่แล้ว
 */
export function flattenFields(
  nested: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(nested)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(
        flat,
        flattenFields(value as Record<string, unknown>, path),
      );
    } else {
      flat[path] = value;
    }
  }
  return flat;
}
