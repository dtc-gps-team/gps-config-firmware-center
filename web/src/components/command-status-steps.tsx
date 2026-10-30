import { CheckIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * สถานะคำสั่งที่ส่งถึงกล่อง (รอส่ง → ส่งแล้ว → อุปกรณ์ตอบรับ → สำเร็จ/ล้มเหลว)
 * map จากสถานะดิบของ Server กลาง · สถานะที่ไม่รู้จักไม่เดา แสดงเฉพาะข้อความ
 */
export type CommandStage = {
  /** ขั้นที่ทำถึงแล้ว 0 = รอส่ง ... 3 = กล่องตอบรับแล้ว (รวมระหว่างติดตั้ง) */
  reached: 0 | 1 | 2;
  outcome: "pending" | "success" | "failed";
};

const DELIVERED = new Set(["DELIVERED"]);
const ACKED = new Set([
  "ACKNOWLEDGED",
  "DOWNLOADING",
  "VALIDATING",
  "INSTALLING",
  "REBOOTING",
]);
const FAILED = new Set(["FAILED", "ROLLED_BACK", "EXPIRED"]);

export function commandStage(status: string): CommandStage | null {
  if (status === "PENDING") return { reached: 0, outcome: "pending" };
  if (DELIVERED.has(status)) return { reached: 1, outcome: "pending" };
  if (ACKED.has(status)) return { reached: 2, outcome: "pending" };
  if (status === "SUCCESS") return { reached: 2, outcome: "success" };
  if (FAILED.has(status)) return { reached: 1, outcome: "failed" };
  return null;
}

const STEPS = ["รอส่ง", "ส่งแล้ว", "อุปกรณ์ตอบรับ"] as const;

export function CommandStatusSteps({ status }: { status: string }) {
  const stage = commandStage(status);
  if (!stage) return null;
  const { reached, outcome } = stage;
  const last =
    outcome === "failed"
      ? { label: "ล้มเหลว", done: true, bad: true }
      : { label: "สำเร็จ", done: outcome === "success", bad: false };

  return (
    <ol
      aria-label="ความคืบหน้าของคำสั่ง"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
    >
      {[
        ...STEPS.map((label, i) => ({ label, done: i <= reached, bad: false })),
        last,
      ].map((step, i, all) => (
        <li key={step.label} className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors duration-(--duration-base) ease-(--ease-standard)",
              step.bad
                ? "bg-danger-subtle text-danger-foreground"
                : step.done
                  ? "bg-success-subtle text-success-foreground"
                  : "bg-secondary text-muted-foreground",
            )}
            aria-current={outcome === "pending" && i === reached ? "step" : undefined}
          >
            {step.bad ? (
              <XIcon className="size-3" />
            ) : step.done ? (
              <CheckIcon className="size-3" />
            ) : null}
            {step.label}
          </span>
          {i < all.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
