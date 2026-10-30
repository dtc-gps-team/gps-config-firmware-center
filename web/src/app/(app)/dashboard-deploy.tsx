"use client";

import Link from "next/link";

import { CountUp } from "@/components/motion/count-up";
import { RingGauge } from "@/components/ring-gauge";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusLed } from "@/components/ui/status-led";
import type { DeployTotals } from "@/lib/dashboard-metrics";
import { Panel, PanelEmpty } from "./dashboard-panel";

/** เกณฑ์ล้มเหลวที่ Rollout หยุดอัตโนมัติ (ดูข้อความสถานะ paused ใน
 *  lib/status-pill.ts: "ล้มเหลวเกิน 5%") — ใช้เป็นเกณฑ์เตือนที่ Dashboard ด้วย */
export const FAILURE_WARN_PERCENT = 5;

/** ผลการ Deploy รวม: วงแหวน % ความสำเร็จ + จำนวนสำเร็จ/ล้มเหลว · ล้มเหลวเกินเกณฑ์
 *  ขึ้นแถบเตือนสั้นๆ พร้อมลิงก์ไปรายการ Campaign */
export function DashboardDeploy({
  deploy,
  loading,
  error,
  onRetry,
  className,
}: {
  deploy: DeployTotals | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const total = deploy ? deploy.success + deploy.failed : 0;
  const percent = deploy && total > 0 ? Math.round((deploy.success / total) * 100) : 0;
  const failurePercent = deploy && total > 0 ? (deploy.failed / total) * 100 : 0;
  const warn = failurePercent >= FAILURE_WARN_PERCENT;

  return (
    <Panel title="ผลการ Deploy" href="/campaigns" className={className}>
      {error ? (
        <ErrorState message="โหลดไม่สำเร็จ" onRetry={onRetry} />
      ) : loading && deploy === null ? (
        <div className="flex items-center gap-5">
          <Skeleton className="size-32 shrink-0 rounded-full" />
          <Skeleton className="h-16 flex-1" />
        </div>
      ) : total === 0 ? (
        <PanelEmpty>ยังไม่มีการ Deploy</PanelEmpty>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <RingGauge
            label={`สำเร็จ ${deploy?.success} ล้มเหลว ${deploy?.failed}`}
            segments={[
              { key: "success", label: "สำเร็จ", value: deploy?.success ?? 0, strokeClass: "stroke-success" },
              { key: "failed", label: "ล้มเหลว", value: deploy?.failed ?? 0, strokeClass: "stroke-destructive" },
            ]}
          >
            <CountUp
              value={percent}
              suffix="%"
              className="text-3xl font-semibold tracking-tight"
            />
            <span className="text-xs text-muted-foreground">ความสำเร็จ</span>
          </RingGauge>

          <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch">
            <dl className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-0.5">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-success" />
                  สำเร็จ
                </dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  <CountUp value={deploy?.success ?? 0} />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-destructive" />
                  ล้มเหลว
                </dt>
                <dd
                  className={
                    warn
                      ? "text-2xl font-semibold text-danger-foreground tabular-nums"
                      : "text-2xl font-semibold tabular-nums"
                  }
                >
                  <CountUp value={deploy?.failed ?? 0} />
                </dd>
              </div>
            </dl>

            {warn && (
              <Link
                href="/campaigns"
                className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-danger-subtle px-3 py-2 text-xs text-danger-foreground outline-none transition-colors duration-(--duration-fast) hover:border-destructive/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <StatusLed tone="danger" pulse />
                <span className="min-w-0 flex-1">
                  ล้มเหลว {Math.round(failurePercent)}% (เกณฑ์{" "}
                  {FAILURE_WARN_PERCENT}%)
                </span>
                <span className="shrink-0 font-medium">ดู Campaign</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
