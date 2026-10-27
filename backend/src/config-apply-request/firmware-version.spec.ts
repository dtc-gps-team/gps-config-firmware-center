import { compareFirmwareVersions } from './firmware-version';

describe('compareFirmwareVersions (docs/27 D5)', () => {
  it.each([
    ['1.0.0', '1.2.0', -1],
    ['1.2.0', '1.0.0', 1],
    ['1.2.0', '1.2.0', 0],
    // เทียบเป็นตัวเลข ไม่ใช่ข้อความ
    ['1.10.0', '1.9.2', 1],
    // ส่วนที่ขาดถือเป็น 0 / นำหน้าด้วย v ได้
    ['1.2', '1.2.0', 0],
    ['v2.0.0', '2.0.0', 0],
    // pre-release ต่ำกว่าเวอร์ชันเต็มเดียวกัน
    ['3.0.0-beta', '3.0.0', -1],
    ['3.0.0-beta', '3.0.0-alpha', 1],
    ['3.0.0-beta', '2.9.9', 1],
    // ส่วนที่ไม่ใช่ตัวเลขถือเป็น 0 (ไม่ throw)
    ['x.y', '0.0.1', -1],
  ])('%s เทียบ %s -> %d', (a, b, expected) => {
    expect(Math.sign(compareFirmwareVersions(a, b))).toBe(expected);
  });
});
