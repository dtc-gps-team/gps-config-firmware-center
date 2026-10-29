import { cn } from "@/lib/utils";

/**
 * สัญลักษณ์ของระบบ: หมุดตำแหน่งสีขาวบนกรอบสีน้ำเงินหลัก กลางหมุดเป็น LED สีเขียว
 * (ลายเซ็นเดียวกับจุดสถานะทั้งระบบ) และคลื่นสัญญาณสองวงที่แผ่ออกด้านขวา สื่อว่า
 * "ตำแหน่งที่มีสัญญาณ" = อุปกรณ์ GPS ที่กำลังรายงาน — ใช้ที่ sidebar และหน้า login
 *
 * `app/icon.svg` (favicon) วาดหมุด + LED เหมือนกัน แต่ตัดคลื่นสัญญาณออกเพราะที่
 * ขนาด 16px เส้นคลื่นเล็กจนเป็นรอยเลอะ — แก้รูปหมุดที่หนึ่งให้แก้อีกที่ด้วย
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 shrink-0 text-white", className)}
    >
      <svg viewBox="0 0 32 32" className="size-full" fill="none">
        <rect width="32" height="32" rx="8" className="fill-sidebar-primary" />
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="7.5"
          stroke="currentColor"
          strokeOpacity="0.12"
        />
        {/* หมุด (รูกลางเจาะทะลุให้เห็นสีกรอบ) */}
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M14 26C14 26 7.5 20.6 7.5 14.5a6.5 6.5 0 1 1 13 0C20.5 20.6 14 26 14 26ZM14 11.8a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 1 0 0-5.4Z"
        />
        {/* LED กลางหมุด */}
        <circle cx="14" cy="14.5" r="1.7" className="fill-success" />
        {/* คลื่นสัญญาณ */}
        <path
          d="M21.43 7.81A10 10 0 0 1 23.51 17.59"
          stroke="currentColor"
          strokeOpacity="0.8"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M23.81 5.67A13.2 13.2 0 0 1 26.55 18.58"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
