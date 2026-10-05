"use client";

import { useState } from "react";

/**
 * "โหลดล่าสุด HH:mm น." ใต้หัวข้อ Dashboard — เทียบกับ mockup UX/UI Design
 * ต้นฉบับที่มี timestamp ความสดของข้อมูลใต้หัวข้อ (UIWEB-001) — ตั้งใจเขียนว่า
 * "โหลดล่าสุด" ไม่ใช่ "อัปเดตล่าสุด" เพราะหน้านี้ไม่มี auto-refresh/websocket
 * จริง ค่าที่เห็นคือตอนที่เปิดหน้านี้ ไม่ใช่ sync สดจากเซิร์ฟเวอร์ตลอดเวลา —
 * บอกตามจริงดีกว่าให้ความรู้สึกผิดว่าข้อมูลสดกว่าที่เป็นจริง (mirror หลักการ
 * เดียวกับ badge "ตัวอย่าง" บนการ์ด demo)
 */
export function DashboardLoadedAt() {
  const [loadedAt] = useState(() =>
    new Date().toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  );

  return (
    <p className="text-xs text-muted-foreground">โหลดล่าสุด {loadedAt} น.</p>
  );
}
