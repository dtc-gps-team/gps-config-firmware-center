"use client";

import { useMemo } from "react";

import { ErrorState } from "@/components/error-state";
import { SegmentBar, type Segment } from "@/components/segment-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  FIRMWARE_APPROVAL_STATUSES,
  type Firmware,
  type FirmwareApprovalStatus,
} from "@/lib/firmware-api";
import { statusLabel } from "@/lib/status-pill";
import { Panel, PanelEmpty } from "./dashboard-panel";

const COLOR: Record<FirmwareApprovalStatus, string> = {
  pending_review: "bg-warning",
  approved: "bg-success",
  rejected: "bg-destructive",
};

/** สัดส่วน Firmware ในคลังแยกตามผลการตรวจคุณภาพ (ของ FirmwareEngineer/QAEngineer) */
export function DashboardFirmwareStatus({
  firmware,
  loading,
  error,
  onRetry,
  className,
}: {
  firmware: Firmware[] | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const segments = useMemo<Segment[]>(
    () =>
      FIRMWARE_APPROVAL_STATUSES.map((status) => ({
        key: status,
        label: statusLabel(status),
        value: (firmware ?? []).filter((f) => f.approvalStatus === status).length,
        colorClass: COLOR[status],
      })),
    [firmware],
  );
  const total = segments.reduce((n, s) => n + s.value, 0);

  return (
    <Panel
      title="สถานะ Firmware ในคลัง"
      href="/firmware"
      description={`${total.toLocaleString("th-TH")} เวอร์ชัน`}
      className={className}
    >
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading && firmware === null ? (
        <Skeleton className="h-10 w-full" />
      ) : total === 0 ? (
        <PanelEmpty>ยังไม่มี Firmware ในคลัง</PanelEmpty>
      ) : (
        <>
          <SegmentBar segments={segments} legend={false} />
          <ul className="flex flex-col divide-y text-sm">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5 py-2">
                <span className={cn("size-2 shrink-0 rounded-full", s.colorClass)} />
                <span className={s.value === 0 ? "text-muted-foreground" : ""}>
                  {s.label}
                </span>
                <span data-tabular className="ml-auto font-medium tabular-nums">
                  {s.value}
                </span>
                <span
                  data-tabular
                  className="w-12 text-right text-xs text-muted-foreground tabular-nums"
                >
                  {Math.round((s.value / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
