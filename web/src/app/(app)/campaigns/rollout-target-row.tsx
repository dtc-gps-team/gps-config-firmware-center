"use client";

import { Fragment, useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { ApplyAttemptHistory } from "@/components/apply-attempt-history";
import { ChangeFlash } from "@/components/motion/change-flash";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { useCampaignRolloutTargetAttempts } from "@/hooks/use-campaign-rollout-target-attempts";
import { useNow } from "@/hooks/use-now";
import type { CampaignRolloutTarget } from "@/lib/campaign-api";
import { retryCountdownText } from "@/lib/field-apply-retry-display";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import {
  ROLLOUT_MAX_ATTEMPTS,
  isTargetWaitingRetry,
  targetBadgeAttempt,
  targetHasHistory,
} from "@/lib/rollout-retry-display";
import { rolloutTargetStatusLabel } from "@/lib/rollout-target-display";
import {
  CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE,
  StatusPill,
} from "@/lib/status-pill";

/**
 * แถวผลต่อเครื่องของ Rollout + การลองส่งใหม่อัตโนมัติ (docs/31 §6.4): ป้าย "รอบ 2/3", นับถอยหลังตอนรอรอบใหม่
 * และปุ่มกางดูประวัติรายรอบ (โหลดตอนกางเท่านั้น) · กติกาข้อความเดียวกับการ์ดบนหน้าอุปกรณ์
 */
export function RolloutTargetRow({
  campaignId,
  rolloutId,
  target,
}: {
  campaignId: string;
  rolloutId: string;
  target: CampaignRolloutTarget;
}) {
  const [open, setOpen] = useState(false);
  const waiting = isTargetWaitingRetry(target);
  const now = useNow(waiting);
  const badge = targetBadgeAttempt(target);
  const hasHistory = targetHasHistory(target);
  const attempts = useCampaignRolloutTargetAttempts(
    campaignId,
    rolloutId,
    target.id,
    open && hasHistory,
    `${target.attemptCount}:${target.status}:${target.nextRetryAt ?? ""}`,
  );

  return (
    <Fragment>
      <TableRow className="relative">
        <TableCell className="font-instrument text-xs">
          <ChangeFlash signal={target.status} />
          {target.deviceId}
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill
                tone={
                  CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE[target.status] ??
                  "neutral"
                }
              >
                {rolloutTargetStatusLabel(target.status)}
              </StatusPill>
              {badge !== null && (
                <StatusPill tone="info">
                  รอบ {badge}/{ROLLOUT_MAX_ATTEMPTS}
                </StatusPill>
              )}
            </div>
            {waiting && target.nextRetryAt && (
              <span className="text-xs font-medium" role="status">
                {retryCountdownText(target.nextRetryAt, now)}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="max-w-md whitespace-normal break-words text-muted-foreground">
          {target.resultDetail ?? "-"}
          {hasHistory && (
            <div className="mt-1">
              <Button
                variant="ghost"
                size="xs"
                aria-expanded={open}
                aria-label={`${open ? "ซ่อน" : "ดู"}ประวัติการส่งของ ${target.deviceId}`}
                onClick={() => setOpen((v) => !v)}
              >
                ประวัติการส่ง
                <ChevronDownIcon
                  className={
                    open
                      ? "rotate-180 transition-transform"
                      : "transition-transform"
                  }
                />
              </Button>
            </div>
          )}
        </TableCell>
        <TableCell
          className="text-right text-muted-foreground"
          title={formatDateTime(target.updatedAt)}
        >
          {formatRelativeTime(target.updatedAt)}
        </TableCell>
      </TableRow>
      {open && hasHistory && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="whitespace-normal bg-muted/30">
            {attempts.error ? (
              <p className="text-sm text-destructive">{attempts.error}</p>
            ) : attempts.data === null ? (
              <p className="text-sm text-muted-foreground">
                กำลังโหลดประวัติการส่ง…
              </p>
            ) : attempts.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                ไม่มีประวัติรายรอบของเครื่องนี้
              </p>
            ) : (
              <ApplyAttemptHistory attempts={attempts.data} />
            )}
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
