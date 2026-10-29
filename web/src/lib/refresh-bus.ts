/**
 * สัญญาณ "รีเฟรชข้อมูลหน้านี้" จากปุ่ม refresh ที่หัวหน้า — hook โหลดข้อมูลทุกตัว
 * ที่ใช้ `useRefetchOnFocus` ฟังสัญญาณนี้อยู่แล้ว จึงไม่ต้องส่ง refetch ข้าม
 * component · ใช้ DOM event บน window (ไม่มี state กลางเพิ่ม)
 */
const REFRESH_EVENT = "gps:refresh";

export function requestRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function subscribeRefresh(listener: () => void): () => void {
  window.addEventListener(REFRESH_EVENT, listener);
  return () => window.removeEventListener(REFRESH_EVENT, listener);
}
