/** ส่งออก CSV ฝั่ง client (ไม่มี endpoint ส่งออก) ใช้ร่วมกันทุกหน้า */

export function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

/** ดาวน์โหลดไฟล์ CSV (ใส่ BOM ให้ Excel อ่านภาษาไทยถูก) */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
