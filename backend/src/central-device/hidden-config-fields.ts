/** ไม่ส่งค่าเหล่านี้ออกไปหาช่าง — `data_server.path` มี key ส่ง telemetry อยู่ใน URL (docs/23 §7) */
const HIDDEN_CONFIG_FIELDS = ['data_server.path'];

/** ตัดค่าที่ห้ามเปิดเผยออกจาก map ชื่อพารามิเตอร์ -> ค่า (ไม่ใช่ map = คืนตามเดิม) */
export function omitHiddenConfigFields<T>(fields: T): T {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    return fields;
  }
  const visible = { ...fields } as Record<string, unknown>;
  for (const key of HIDDEN_CONFIG_FIELDS) delete visible[key];
  return visible as T;
}
