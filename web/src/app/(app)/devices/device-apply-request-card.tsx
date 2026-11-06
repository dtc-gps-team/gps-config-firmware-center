"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeviceApplyRequest } from "@/hooks/use-device-apply-request";
import { formatDateTime } from "@/lib/format-date";
import {
  ATTEMPT_STATUS_LABEL,
  FIELD_APPLY_STATUS_LABEL,
  FIELD_APPLY_STATUS_TONE,
  badgeAttempt,
  failureTitle,
  isWaitingRetry,
  lastFailureReason,
  retryCountdownText,
  showAttemptHistory,
} from "@/lib/field-apply-retry-display";
import { canReadFieldApplyRequests } from "@/lib/permissions";
import { StatusPill } from "@/lib/status-pill";
import type { FieldApplyAttempt } from "@/lib/field-apply-request-api";

/** เวลาปัจจุบันที่ขยับทุกวินาทีเฉพาะตอน `active` (นับถอยหลัง) — ไม่ tick ตอนไม่จำเป็น */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // ปรับเวลาทันทีที่เริ่มนับ (ค่าเริ่มต้นของ state มาจากตอน mount อาจเก่า) แล้วขยับทุกวินาที
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active]);
  return now;
}

function AttemptHistory({ attempts }: { attempts: FieldApplyAttempt[] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="apply-attempt-history">
      <p className="text-sm font-medium">ประวัติการส่ง</p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {attempts.map((a) => {
          const bad = a.status === "failed" || a.status === "skipped";
          const reason = a.detail ?? a.errorCode;
          return (
            <li
              key={a.attemptNo}
              className="flex items-start gap-3 px-3 py-2 text-sm"
            >
              <span className="w-14 shrink-0 font-medium">รอบ {a.attemptNo}</span>
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
                  <span className="text-xs text-muted-foreground">{reason}</span>
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

/**
 * การ์ด "การส่งเข้ากล่อง" บนหน้ารายละเอียดอุปกรณ์ — คำขอส่ง Config/Firmware จากหน้างานล่าสุดของเครื่องนี้ ·
 * สถานะ, ป้าย "รอบ 2/3" + นับถอยหลังตอนรอรอบใหม่ และประวัติรายรอบ (docs/31 §3.7 กติกาเดียวกับ Mobile) ·
 * Operation/Auditor/Admin/SuperAdmin เท่านั้น (role อื่นไม่ยิง · ไม่แสดงการ์ด) · ไม่มีคำขอเลย = ไม่แสดงการ์ด
 * เว็บไม่มีปุ่ม "ส่งใหม่" การส่งเป็นหน้าที่ของช่างบน Mobile
 */
export function DeviceApplyRequestCard({ deviceId }: { deviceId: string }) {
  const { session } = useAuth();
  const allowed = canReadFieldApplyRequests(session?.role);
  const { request, progress, isLoading, error } = useDeviceApplyRequest(
    deviceId,
    allowed,
  );
  const waiting = isWaitingRetry(progress);
  const now = useNow(waiting);

  if (!allowed) return null;
  if (isLoading && !request) return null;
  if (error && !request) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>การส่งเข้ากล่อง</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }
  if (!request) return null;

  const kindLabel = request.kind === "firmware" ? "Firmware" : "Config";
  const subject =
    request.kind === "firmware"
      ? request.firmware?.version
        ? `Firmware ${request.firmware.version}`
        : "Firmware"
      : (request.config?.name ?? "Config");
  const retry = progress?.retry ?? null;
  const attempts = retry?.attempts ?? [];
  const badge = badgeAttempt(progress);
  const status = progress?.status ?? request.status;
  const failed = status === "failed" || status === "skipped_offline";

  return (
    <Card className="w-full" data-testid="device-apply-request-card">
      <CardHeader>
        <CardTitle>การส่งเข้ากล่อง</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={FIELD_APPLY_STATUS_TONE[status] ?? "neutral"}>
            {FIELD_APPLY_STATUS_LABEL[status] ?? status}
          </StatusPill>
          {badge !== null && retry && (
            <StatusPill tone="info">
              รอบ {badge}/{retry.maxAttempts}
            </StatusPill>
          )}
          <span className="text-sm text-muted-foreground">
            {kindLabel} {subject} ขอโดย {request.requester.fullName}{" "}
            {formatDateTime(request.requestedAt)}
          </span>
        </div>

        {waiting && retry?.nextRetryAt && (
          <p className="text-sm font-medium" role="status">
            {retryCountdownText(retry.nextRetryAt, now)}
          </p>
        )}

        {failed && attempts.length > 0 && (
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-medium">{failureTitle(attempts)}</span>
            {lastFailureReason(attempts) && (
              <span className="text-muted-foreground">
                สาเหตุรอบสุดท้าย: {lastFailureReason(attempts)}
              </span>
            )}
          </div>
        )}

        {showAttemptHistory(attempts) && <AttemptHistory attempts={attempts} />}
      </CardContent>
    </Card>
  );
}
