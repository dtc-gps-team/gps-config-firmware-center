import { cn } from "@/lib/utils"

/**
 * จุดสถานะแบบ LED (ลายเซ็นของระบบ GPS) — สีเดียวกับ semantic token
 * `pulse` ใช้กับสถานะที่ "กำลังมีชีวิต" เท่านั้น (online / updating) ไม่ใช้
 * กับสถานะนิ่งอย่างออฟไลน์ · วงแหวนขยายด้วย transform+opacity และหยุดเมื่อ
 * ผู้ใช้ตั้ง prefers-reduced-motion
 */
export type LedTone =
  | "online"
  | "offline"
  | "warning"
  | "danger"
  | "info"
  | "neutral"

const LED_COLOR: Record<LedTone, string> = {
  online: "bg-success",
  offline: "bg-status-offline",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground/60",
}

function StatusLed({
  tone,
  pulse = false,
  className,
}: {
  tone: LedTone
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      data-slot="status-led"
      aria-hidden="true"
      className={cn("relative inline-flex size-2 shrink-0", className)}
    >
      {pulse && (
        <span
          className={cn(
            "absolute inset-0 animate-led rounded-full",
            LED_COLOR[tone]
          )}
        />
      )}
      <span
        className={cn(
          "relative size-2 rounded-full transition-colors duration-(--duration-base) ease-(--ease-standard)",
          LED_COLOR[tone]
        )}
      />
    </span>
  )
}

export { StatusLed }
