import { StatusLed, type LedTone } from "@/components/ui/status-led";
import { cn } from "@/lib/utils";

/**
 * ป้ายสถานะแบบ LED: จุดสี + ข้อความ บนพื้นอ่อนโปร่ง (สีเปลี่ยนแบบ transition)
 * ใช้กับสถานะที่ไม่ผูกกับ enum เฉพาะ (ออนไลน์/ออฟไลน์, ผลรวมของ deploy ฯลฯ) —
 * สถานะ lifecycle ของ Config/Campaign ฯลฯ ยังใช้ `StatusPill` (lib/status-pill)
 * ซึ่งแปลง enum → tone ไว้แล้ว
 */
const TONE_SURFACE: Record<LedTone, string> = {
  online: "bg-success-subtle text-success-foreground",
  offline: "bg-secondary text-secondary-foreground/80",
  warning: "bg-warning-subtle text-warning-foreground",
  danger: "bg-danger-subtle text-danger-foreground",
  info: "bg-info-subtle text-info-foreground",
  neutral: "bg-secondary text-secondary-foreground/80",
};

export function StatusBadge({
  tone,
  pulse = false,
  className,
  children,
}: {
  tone: LedTone;
  /** LED เต้นเบาๆ สำหรับสถานะที่ยังเคลื่อนไหวอยู่ (online / updating) */
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-(--duration-base) ease-(--ease-standard)",
        TONE_SURFACE[tone],
        className,
      )}
    >
      <StatusLed tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}
