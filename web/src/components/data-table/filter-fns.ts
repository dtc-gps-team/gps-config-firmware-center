import type { FilterFn } from "@tanstack/react-table";

/**
 * multi-select: filterValue = string[] ของค่าที่เลือก · แถวผ่านถ้าค่าในคอลัมน์
 * (แปลงเป็น string) อยู่ในลิสต์ · ลิสต์ว่าง = ไม่กรอง
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const multiSelectFilterFn: FilterFn<any> = (row, columnId, filterValue) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  const value = row.getValue(columnId);
  return (filterValue as string[]).includes(String(value));
};
multiSelectFilterFn.autoRemove = (value) =>
  !Array.isArray(value) || value.length === 0;

/**
 * date range: filterValue = [from?: string, to?: string] (`YYYY-MM-DD` จาก
 * `<input type="date">`) · เทียบเป็น "วันตามเวลาเครื่องผู้ใช้" (ตรงกับที่คอลัมน์
 * แสดงผลด้วย `toLocaleString`) — เลี่ยงปัญหา timezone รอบเที่ยงคืน · `to` นับ
 * รวมทั้งวันนั้น · ไม่มีทั้ง from และ to = ไม่กรอง
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dateRangeFilterFn: FilterFn<any> = (row, columnId, filterValue) => {
  const [from, to] = (filterValue ?? []) as [string?, string?];
  if (!from && !to) return true;

  const d = new Date(row.getValue(columnId) as string);
  if (Number.isNaN(d.getTime())) return false;

  // วันที่ตามเวลาเครื่อง (local) เป็นสตริง YYYY-MM-DD — เทียบ lexical ได้ตรง
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
};
dateRangeFilterFn.autoRemove = (value) => {
  const [from, to] = (value ?? []) as [string?, string?];
  return !from && !to;
};
