import { cn } from "@/lib/utils";

/**
 * สัญลักษณ์ของระบบ (หมุดตำแหน่ง) — ไม่มีกรอบพื้นหลัง ตัวหมุดลอยบนพื้นเลย จึงต้องเลือก
 * โทนให้เข้ากับพื้น: `dark` = พื้นเข้ม (sidebar สีกรมท่า) หมุดสีขาว · `light` = พื้น
 * สว่าง/การ์ด (หน้า login) หมุดสีหลักของธีม · ใช้เป็นต้นแบบของ favicon
 * (`app/icon.svg` วาดรูปเดียวกัน แก้ที่หนึ่งให้แก้อีกที่ด้วย)
 */
export const LOGO_VIEWBOX = "2 1 20 22";
export const LOGO_PIN_PATH =
  "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0";
export const LOGO_STROKE_WIDTH = 1.9;

export function LogoMark({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0",
        tone === "dark" ? "text-white" : "text-primary",
        className,
      )}
    >
      <svg
        viewBox={LOGO_VIEWBOX}
        fill="none"
        stroke="currentColor"
        strokeWidth={LOGO_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-full"
      >
        <path d={LOGO_PIN_PATH} />
        <circle cx="12" cy="10" r="3" />
      </svg>
    </span>
  );
}
