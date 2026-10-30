import { StatusLed, type LedTone } from "@/components/ui/status-led";
import { cn } from "@/lib/utils";

export type ConnectionState = "online" | "offline" | "unknown";

const STATE_TONE: Record<ConnectionState, LedTone> = {
  online: "online",
  offline: "offline",
  unknown: "neutral",
};

/** ตัวบอกการเชื่อมต่อ: LED + ข้อความ (ข้อความไม่ใช่สีอย่างเดียว) ·
 *  online เท่านั้นที่ LED เต้น */
export function ConnectionIndicator({
  state,
  label,
  className,
}: {
  state: ConnectionState;
  label: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <StatusLed tone={STATE_TONE[state]} pulse={state === "online"} />
      {label}
    </span>
  );
}
