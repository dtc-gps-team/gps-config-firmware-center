import { cn } from "@/lib/utils";

/**
 * สัญลักษณ์ของระบบ: ชิปโมดูล GPS มองจากด้านบน — มุมซ้ายบนตัดเฉียงแบบจุดอ้างอิงขา 1
 * ของชิปจริง, ขารอบตัวชิป (Config ของอุปกรณ์), ตรงกลางเป็นเป้าตำแหน่งที่มีจุด LED
 * เขียวตรงจุดที่จับพิกัดได้ (GPS) ตัวชิปเองคือเฟิร์มแวร์ที่ระบบนี้จัดการ — ใช้สีเรียบ
 * ไม่ไล่สี เส้นหนาเท่ากัน อ่านออกที่ 16px · ใช้ที่ sidebar และหน้า login
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
        {/* ตัวชิป: มุมซ้ายบนตัดเฉียง */}
        <path
          d="M14 8.5H20.5a3.5 3.5 0 0 1 3.5 3.5V20a3.5 3.5 0 0 1-3.5 3.5H12A3.5 3.5 0 0 1 8.5 20V14Z"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* ขาชิป (ไม่มีขาบนซ้ายตรงมุมตัด) */}
        <path
          d="M19.4 4.8v3M12.6 24.2v3M19.4 24.2v3M4.8 19.4h3M4.8 12.6h3M24.2 12.6h3M24.2 19.4h3"
          stroke="white"
          strokeOpacity="0.72"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        {/* เป้าตำแหน่ง */}
        <circle cx="16.2" cy="16.2" r="3" stroke="white" strokeWidth="1.7" />
        <path
          d="M16.2 10.9v1.6M16.2 19.9v1.6M10.9 16.2h1.6M19.9 16.2h1.6"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* LED: จุดที่จับพิกัดได้ */}
        <circle cx="16.2" cy="16.2" r="1.35" className="fill-brand-accent" />
      </svg>
    </span>
  );
}
