import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * สัญลักษณ์ของระบบ สื่อสามหน้าที่ในรูปเดียว: หมุดตำแหน่ง = GPS, ลูกศรชี้ขึ้นกลางหมุด
 * = อัปโหลดเฟิร์มแวร์, แถบเลื่อนสองเส้นข้างหมุด = ปรับค่า Config (ปุ่มเลื่อนอันหนึ่งเป็น
 * สีเขียวสดเหมือน LED ของระบบ) บนกรอบสี่เหลี่ยมมุมโค้งไล่โทนน้ำเงินเดียวกัน
 *
 * `app/icon.svg` (favicon) วาดรูปเดียวกัน (สีตายตัวเพราะ favicon ไม่อ่าน CSS variable)
 * — แก้รูปที่หนึ่งให้แก้อีกที่ด้วย · gradient ใช้ id ต่อ instance (`useId`) เพราะ
 * sidebar กับ Sheet มือถือวาดโลโก้พร้อมกัน และ svg ที่อยู่ใน `display: none` จะทำให้
 * gradient ที่ใช้ id ซ้ำกันหายไป
 */
export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId();

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 shrink-0", className)}
    >
      <svg viewBox="0 0 32 32" className="size-full" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="4" y1="0" x2="28" y2="32">
            <stop offset="0" style={{ stopColor: "var(--brand-500)" }} />
            <stop offset="1" style={{ stopColor: "var(--brand-700)" }} />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="10" fill={`url(#${gradientId})`} />
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="9.5"
          stroke="white"
          strokeOpacity="0.16"
        />
        {/* GPS: หมุดตำแหน่ง */}
        <path
          fill="white"
          d="M12.5 27.5C12.5 27.5 5 21.2 5 14.5a7.5 7.5 0 1 1 15 0C20 21.2 12.5 27.5 12.5 27.5Z"
        />
        {/* เฟิร์มแวร์: ลูกศรอัปโหลด */}
        <path
          d="M12.5 20.2V10.2M9 13.7l3.5-3.7 3.5 3.7"
          className="stroke-brand-600"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Config: แถบเลื่อนสองเส้น */}
        <path
          d="M22 10.8h7.3M22 18.2h7.3"
          stroke="white"
          strokeOpacity="0.62"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle cx="26.6" cy="10.8" r="2.25" fill="white" />
        <circle cx="24.6" cy="18.2" r="2.25" className="fill-brand-accent" />
      </svg>
    </span>
  );
}
