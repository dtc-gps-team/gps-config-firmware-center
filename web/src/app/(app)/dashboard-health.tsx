import Link from "next/link";

import { ChangeFlash } from "@/components/motion/change-flash";
import { CountUp } from "@/components/motion/count-up";
import { StatusLed, type LedTone } from "@/components/ui/status-led";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Panel } from "./dashboard-panel";

/**
 * การ์ด "สถานะระบบ" — แถบสรุปสั้นใต้ "งานที่ต้องดำเนินการ" (เรียงแนวนอนเต็มความกว้าง ไม่เหลือพื้นที่ว่างข้างคิว) ทุกแถวเป็น
 * LED + ชื่อ + ค่า: ค่า > 0 ที่ต้องสนใจใช้สี/LED เต้น, ปกติเป็นเขียวจาง · แถวที่
 * ยังไม่มีหน้าปลายทางที่ตรงกับตัวเลข (ไม่ใส่ `href`) ไม่เป็นลิงก์
 */
export function HealthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel title="สถานะระบบ" className={className}>
      <ul className="grid divide-y sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] sm:divide-x sm:divide-y-0">{children}</ul>
    </Panel>
  );
}

type HealthRowProps = {
  label: string;
  /** null = ยังโหลดอยู่ */
  value: number | null;
  /** ข้อความแทนตัวเลข (เช่น "84%") */
  text?: string;
  error?: string | null;
  /** แหล่งข้อมูลติดต่อไม่ได้ แสดง "ไม่ทราบ" ไม่ใช่เลข 0 ที่ดูเหมือนปกติ */
  unavailable?: boolean;
  /** โทนเมื่อมีสิ่งที่ต้องสนใจ (ค่า > 0) */
  attention?: "danger" | "warning" | null;
  href?: string;
  hint?: string;
  children?: React.ReactNode;
};

export function HealthRow({
  label,
  value,
  text,
  error,
  unavailable,
  attention = null,
  href,
  hint,
  children,
}: HealthRowProps) {
  const flagged = attention !== null && (value ?? 0) > 0 && !error && !unavailable;
  const led: LedTone = flagged
    ? attention === "danger"
      ? "danger"
      : "warning"
    : error || unavailable
      ? "neutral"
      : "online";

  const content = (
    <>
      <div className="flex items-center gap-2.5">
        <StatusLed tone={led} pulse={flagged && attention === "danger"} />
        <span className="min-w-0 flex-1 text-sm">{label}</span>
        <span
          data-tabular
          className={cn(
            "text-2xl font-semibold tabular-nums",
            flagged && attention === "danger" && "text-danger-foreground",
            flagged && attention === "warning" && "text-warning-foreground",
            !flagged && "text-muted-foreground",
          )}
        >
          {error ? (
            <span className="font-normal text-destructive">โหลดไม่สำเร็จ</span>
          ) : unavailable ? (
            <span className="font-normal">ไม่ทราบ</span>
          ) : value === null && text === undefined ? (
            <Skeleton className="h-4 w-8" />
          ) : (
            (text ?? <CountUp value={value ?? 0} />)
          )}
        </span>
      </div>
      {children}
      <ChangeFlash signal={value} />
    </>
  );

  const rowClass =
    "relative flex min-h-14 flex-col justify-center overflow-hidden rounded-md px-4 py-2.5";
  return (
    <li title={hint}>
      {href ? (
        <Link
          href={href}
          className={cn(
            rowClass,
            "rounded-md outline-none transition-colors duration-(--duration-fast) hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}
