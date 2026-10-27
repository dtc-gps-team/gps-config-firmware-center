/**
 * แปลง `Config.fields` คีย์แบบมีจุด (`{ "gps.send_interval_sec": 10 }`) ที่
 * ระบบเราเก็บจริง เป็น `settings` object ซ้อนชั้น (`{ gps: { send_interval_sec:
 * 10 } }`) ให้ตรงกับ JSON ที่ส่งเข้า Server กลางจริงของพี่เลี้ยง (ดู
 * `putDeviceConfig()` wrapper key `settings` ฝั่ง backend) — ใช้กับ JSON ที่
 * หน้า Config Detail ให้คัดลอก/export เท่านั้น เพราะมีคนเอาไปใช้งานจริง (ไม่ใช่
 * แค่ดูเฉยๆ, รีวิวพี่เลี้ยง 27 ต.ค. 2569) mirror การซ้อนชั้นฝั่ง backend
 * (`buildCentralSettings()` ใน `central-config.ts`) แต่ตั้งใจไม่แปลงชนิดค่า
 * (coerce) เพราะค่าใน `Config.fields` ถูกเก็บด้วยชนิดที่ถูกต้องอยู่แล้ว
 */
export function nestFields(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const path = key.split(".");
    let cursor = nested;
    for (const part of path.slice(0, -1)) {
      const next = cursor[part];
      if (typeof next === "object" && next !== null && !Array.isArray(next)) {
        cursor = next as Record<string, unknown>;
      } else {
        const created: Record<string, unknown> = {};
        cursor[part] = created;
        cursor = created;
      }
    }
    cursor[path[path.length - 1]] = value;
  }
  return nested;
}

/**
 * ตัวกลับของ {@link nestFields} — ใช้ประเมิน preview ฝั่ง client ตอนเลือกไฟล์
 * import (นับจำนวน field จริงจาก `settings` ซ้อนชั้นได้ ไม่ใช่แค่จำนวน key
 * ชั้นบนสุด) การ validate จริงยังอยู่ที่ backend เสมอ
 */
export function flattenFields(
  nested: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(nested)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
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
