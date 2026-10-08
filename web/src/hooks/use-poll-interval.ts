"use client";

import { useEffect, useRef } from "react";

/**
 * รีเฟรชอัตโนมัติทุก `intervalMs` (ใช้คู่กับ `useRefetchOnFocus` ไม่ใช่แทนที่ —
 * focus คุมเคส "สลับแท็บกลับมา" ส่วนตัวนี้คุมเคส "เปิดหน้าค้างไว้แล้วมีของใหม่
 * เข้ามา" เช่น Operation เปิด Approval Center ทิ้งไว้ รอ field report ใหม่จาก
 * ST/OT — ไม่ต้อง refocus ก็เห็น) · หยุด poll เมื่อแท็บถูกซ่อน
 * (`visibilityState === 'hidden'`) กันยิง request เปล่าทิ้งไว้เบื้องหลัง —
 * มิเรอร์เงื่อนไขเดียวกับ `useRefetchOnFocus`
 *
 * ใช้ ref เก็บ `refetch` ล่าสุดแทนใส่ใน dependency array ตรงๆ กัน
 * clearInterval/setInterval ใหม่ทุกครั้งที่ตัว `refetch` เปลี่ยน (เช่นตอน
 * filter เปลี่ยนใน hook ที่เรียกใช้) — subscribe แค่ครั้งเดียวตอน mount
 * (เว้นแต่ `intervalMs` เปลี่ยน)
 */
export function usePollInterval(refetch: () => void, intervalMs: number): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refetchRef.current();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}

/**
 * ค่าเริ่มต้นสำหรับคิวรอดำเนินการ (Approval Center, Dashboard, Incidents) —
 * กลางๆ ระหว่าง 15-30 วินาทีที่ตกลงกันไว้ (มติ 2026-10-07) ใช้ค่าเดียวกันทุก
 * hook ที่เรียก `usePollInterval` เพื่อให้พฤติกรรม "รอไม่เกินกี่วินาที" เดา
 * ง่ายสำหรับผู้ใช้ ไม่ต้องจำว่าแต่ละหน้า poll ถี่ไม่เท่ากัน
 */
export const PENDING_QUEUE_POLL_INTERVAL_MS = 20_000;
