import { cn } from "@/lib/utils";

/**
 * สัญลักษณ์ของระบบ (หมุดตำแหน่งในกรอบสีฟ้าหลัก) — ใช้ที่ sidebar, หน้า login
 * และเป็นต้นแบบของ favicon (`app/icon.svg` วาดรูปเดียวกัน แก้ที่หนึ่งให้แก้
 * อีกที่ด้วย)
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-white",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[55%]"
      >
        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    </span>
  );
}
