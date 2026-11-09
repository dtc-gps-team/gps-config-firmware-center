import { formatDateTime } from "@/lib/format-date";
import { ATTEMPT_STATUS_LABEL } from "@/lib/field-apply-retry-display";
import type { FieldApplyAttempt } from "@/lib/field-apply-request-api";

/**
 * ประวัติการส่งรายรอบ (docs/31) — ใช้ร่วมกันระหว่างการ์ดบนหน้าอุปกรณ์ (คำขอจากหน้างาน) และผลต่อเครื่อง
 * ของ Rollout (Campaign ปกติ) เพราะรูปแบบข้อมูลรายรอบเหมือนกัน
 */
export function ApplyAttemptHistory({
  attempts,
  title = "ประวัติการส่ง",
}: {
  attempts: FieldApplyAttempt[];
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="apply-attempt-history">
      <p className="text-sm font-medium">{title}</p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {attempts.map((a) => {
          const bad = a.status === "failed" || a.status === "skipped";
          const reason = a.detail ?? a.errorCode;
          return (
            <li
              key={a.attemptNo}
              className="flex items-start gap-3 px-3 py-2 text-sm"
            >
              <span className="w-14 shrink-0 font-medium">
                รอบ {a.attemptNo}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={
                    a.status === "succeeded"
                      ? "text-success"
                      : bad
                        ? "text-warning-foreground"
                        : undefined
                  }
                >
                  {ATTEMPT_STATUS_LABEL[a.status] ?? a.status}
                </span>
                {bad && reason && (
                  <span className="text-xs text-muted-foreground">
                    {reason}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(a.startedAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
