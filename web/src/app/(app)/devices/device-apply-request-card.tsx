"use client";

import { ApplyAttemptHistory } from "@/components/apply-attempt-history";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeviceApplyRequest } from "@/hooks/use-device-apply-request";
import { useNow } from "@/hooks/use-now";
import { formatDateTime } from "@/lib/format-date";
import {
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

        {showAttemptHistory(attempts) && <ApplyAttemptHistory attempts={attempts} />}
      </CardContent>
    </Card>
  );
}
