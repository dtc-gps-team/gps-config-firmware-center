import { CheckIcon, XIcon } from "lucide-react";

import type { ConfigStatus } from "@/lib/config-api";
import { cn } from "@/lib/utils";

/**
 * เส้นทางชีวิตของ Config (ร่าง → รออนุมัติ → อนุมัติแล้ว → ซิงก์แล้ว) บอกว่าตอนนี้อยู่ขั้นไหน
 * และข้างหน้าเหลืออะไร · ถูกปฏิเสธแสดงที่ขั้น "รออนุมัติ" เป็นสีแดงพร้อมข้อความ (ไม่พึ่งสีอย่างเดียว)
 * สถานะจริงมี 5 ค่า: draft, testing, approved, rejected, synced
 */
const STEPS: { status: ConfigStatus; label: string }[] = [
  { status: "draft", label: "ร่าง" },
  { status: "testing", label: "รออนุมัติ" },
  { status: "approved", label: "อนุมัติแล้ว" },
  { status: "synced", label: "ซิงก์แล้ว" },
];

export function ConfigLifecycleSteps({ status }: { status: ConfigStatus }) {
  const rejected = status === "rejected";
  const current = rejected ? 1 : STEPS.findIndex((s) => s.status === status);

  return (
    <ol
      aria-label="ขั้นของ Config"
      className="flex items-center overflow-hidden rounded-lg border bg-card text-sm"
    >
      {STEPS.map((step, i) => {
        const done = i < current || (i === current && status === "synced");
        const active = i === current;
        const bad = rejected && active;
        return (
          <li
            key={step.status}
            aria-current={active ? "step" : undefined}
            className={cn(
              "relative flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 py-2.5 transition-colors duration-(--duration-base) ease-(--ease-standard)",
              i > 0 && "border-l",
              bad
                ? "bg-danger-subtle font-medium text-danger-foreground"
                : active
                  ? "bg-primary/10 font-medium text-foreground"
                  : done
                    ? "text-success-foreground"
                    : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] tabular-nums",
                bad
                  ? "bg-destructive text-white"
                  : active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-success-subtle text-success-foreground"
                      : "bg-secondary text-muted-foreground",
              )}
            >
              {bad ? (
                <XIcon className="size-3" />
              ) : done ? (
                <CheckIcon className="size-3" />
              ) : (
                i + 1
              )}
            </span>
            <span className="truncate">{bad ? "ถูกปฏิเสธ" : step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
