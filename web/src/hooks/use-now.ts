"use client";

import { useEffect, useState } from "react";

/** เวลาปัจจุบันที่ขยับทุกวินาทีเฉพาะตอน `active` (นับถอยหลัง) — ไม่ tick ตอนไม่จำเป็น */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // ปรับเวลาทันทีที่เริ่มนับ (ค่าเริ่มต้นของ state มาจากตอน mount อาจเก่า) แล้วขยับทุกวินาที
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active]);
  return now;
}
