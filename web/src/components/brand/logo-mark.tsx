import { cn } from "@/lib/utils";

/**
 * สัญลักษณ์ของระบบ: หมุดตำแหน่งที่มีวงโคจรดาวเทียมพาดรอบ — หมุดคือตำแหน่งที่ระบบ
 * ติดตาม ดาวเทียมสีเขียวบนวงโคจรคือสัญญาณ GPS (สีเขียวเดียวกับ LED สถานะทั้งระบบ)
 * กลางหมุดมีจุด LED · สีเรียบ ไม่ไล่สี อ่านออกที่ 16px · ใช้ที่ sidebar และหน้า login
 *
 * `app/icon.svg` (favicon) วาดรูปเดียวกัน (สีตายตัวเพราะ favicon ไม่อ่าน CSS
 * variable) — แก้รูปที่หนึ่งให้แก้อีกที่ด้วย
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 shrink-0", className)}
    >
      <svg viewBox="0 0 32 32" className="size-full" fill="none">
        <rect width="32" height="32" rx="8" className="fill-brand-600" />
        {/* วงโคจร (อยู่หลังหมุด) + ดาวเทียม */}
        <g transform="rotate(-24 16 13.6)">
          <ellipse
            cx="16"
            cy="13.6"
            rx="13.4"
            ry="4.9"
            stroke="white"
            strokeOpacity="0.58"
            strokeWidth="1.6"
          />
          <circle cx="26.2" cy="9.2" r="2.1" className="fill-brand-accent" />
        </g>
        {/* หมุดตำแหน่ง (รูกลางเจาะทะลุให้เห็นสีกรอบ) */}
        <path
          fill="white"
          fillRule="evenodd"
          d="M16 27.8C16 27.8 8.2 20.8 8.2 13.6a7.8 7.8 0 1 1 15.6 0C23.8 20.8 16 27.8 16 27.8ZM16 10.4a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 1 0 0-6.4Z"
        />
        {/* LED กลางหมุด */}
        <circle cx="16" cy="13.6" r="1.4" className="fill-brand-accent" />
      </svg>
    </span>
  );
}
