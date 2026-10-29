import { cn } from "@/lib/utils";

/**
 * สัญลักษณ์ของระบบ: หมุดตำแหน่งที่มีวงโคจรดาวเทียมพาดรอบ — หมุดคือตำแหน่งที่ระบบ
 * ติดตาม ดาวเทียมสีเขียวบนวงโคจรคือสัญญาณ GPS (สีเขียวเดียวกับ LED สถานะทั้งระบบ)
 * กลางหมุดมีจุด LED · **ไม่มีกรอบครอบ** ตัวสัญลักษณ์ลอยบนพื้นเลย (กรอบสี่เหลี่ยมทำให้
 * ดูเป็นไอคอนแอปทั่วไป) จึงต้องเลือกโทนให้เข้ากับพื้น:
 * - `dark` = พื้นเข้ม (sidebar สีกรมท่า) หมุดสีขาว
 * - `light` = พื้นสว่าง (การ์ด login) หมุดสีหลักของธีม
 *
 * `app/icon.svg` (favicon) วาดรูปเดียวกัน (สีตายตัวเพราะ favicon ไม่อ่าน CSS
 * variable) — แก้รูปที่หนึ่งให้แก้อีกที่ด้วย
 */
export function LogoMark({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 shrink-0", className)}
    >
      <svg viewBox="1 3 30 26" className="size-full" fill="none">
        {/* วงโคจร (อยู่หลังหมุด) + ดาวเทียม */}
        <g transform="rotate(-24 16 13.6)">
          <ellipse
            cx="16"
            cy="13.6"
            rx="13.4"
            ry="4.9"
            strokeWidth="1.7"
            className={dark ? "stroke-white/60" : "stroke-primary/45"}
          />
          <circle cx="26.2" cy="9.2" r="2.2" className="fill-brand-accent" />
        </g>
        {/* หมุดตำแหน่ง (รูกลางเจาะทะลุให้เห็นพื้นหลัง) */}
        <path
          fillRule="evenodd"
          className={dark ? "fill-white" : "fill-primary"}
          d="M16 27.8C16 27.8 8.2 20.8 8.2 13.6a7.8 7.8 0 1 1 15.6 0C23.8 20.8 16 27.8 16 27.8ZM16 10.4a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 1 0 0-6.4Z"
        />
        {/* LED กลางหมุด */}
        <circle cx="16" cy="13.6" r="1.5" className="fill-brand-accent" />
      </svg>
    </span>
  );
}
