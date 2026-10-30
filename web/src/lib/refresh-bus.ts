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

/**
 * เวลาที่ข้อมูลสดล่าสุดเข้ามา (ms) — hook ที่ poll เองอย่างสถานะกล่องจาก Server กลาง
 * เรียก `markDataLoaded()` ทุกครั้งที่ดึงสำเร็จ ตัวบอก "อัปเดตล่าสุด" ที่หัวหน้า
 * อ่านค่านี้ จึงสะท้อนความสดจริง ไม่ใช่แค่เวลาที่เปิดหน้า
 */
let dataLoadedAt = 0;
const dataLoadedListeners = new Set<() => void>();

export function markDataLoaded(): void {
  dataLoadedAt = Date.now();
  dataLoadedListeners.forEach((listener) => listener());
}

export function getDataLoadedAt(): number {
  return dataLoadedAt;
}

export function subscribeDataLoaded(listener: () => void): () => void {
  dataLoadedListeners.add(listener);
  return () => {
    dataLoadedListeners.delete(listener);
  };
}
