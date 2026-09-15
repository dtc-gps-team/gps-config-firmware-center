/** ฟอร์แมตขนาดไฟล์ให้อ่านง่าย เช่น "2.4 MB" — ใช้กับหน้า Firmware Repository
 * (ไฟล์ binary ขนาดหลัก MB ต่างจาก Config JSON ที่เล็กจนไม่ต้องมี helper นี้) */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}
