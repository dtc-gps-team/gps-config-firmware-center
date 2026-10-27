/**
 * เทียบเวอร์ชัน Firmware (docs/27 D5) — ใช้ตัดสินว่าคำขอเป็นการถอยเวอร์ชันไหม
 * และเรียงตัวเลือกใน `apply-options` · คืนค่าลบ/0/บวกแบบ comparator
 *
 * - เทียบตัวเลขทีละส่วน (`"1.10.0"` > `"1.9.2"`) ส่วนที่ขาดถือเป็น 0
 *   (`"1.2"` = `"1.2.0"`) · นำหน้าด้วย `v` ได้
 * - ส่วนหลัง `-` เป็น pre-release: ต่ำกว่าเวอร์ชันเต็มเดียวกัน (`"3.0.0-beta"` <
 *   `"3.0.0"`) และเทียบกันเองแบบข้อความ
 * - ส่วนที่ไม่ใช่ตัวเลขถือเป็น 0 — ไม่ throw (เวอร์ชันมาจากผู้อัปโหลด/กล่อง)
 */
export function compareFirmwareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const length = Math.max(pa.numbers.length, pb.numbers.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa.numbers[i] ?? 0) - (pb.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.preRelease === pb.preRelease) return 0;
  if (pa.preRelease === '') return 1;
  if (pb.preRelease === '') return -1;
  return pa.preRelease < pb.preRelease ? -1 : 1;
}

function parseVersion(version: string): {
  numbers: number[];
  preRelease: string;
} {
  const trimmed = version.trim().replace(/^v/i, '');
  const dash = trimmed.indexOf('-');
  const core = dash === -1 ? trimmed : trimmed.slice(0, dash);
  const preRelease = dash === -1 ? '' : trimmed.slice(dash + 1);
  const numbers = core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return { numbers, preRelease };
}
