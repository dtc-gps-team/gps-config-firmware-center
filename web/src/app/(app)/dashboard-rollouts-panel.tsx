"use client";

import Link from "next/link";

import { ErrorState } from "@/components/error-state";
import { RelativeTime } from "@/components/relative-time";
import { SegmentBar } from "@/components/segment-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusLed } from "@/components/ui/status-led";
import type { Campaign, CampaignRollout } from "@/lib/campaign-api";
import { activeRollouts, rolloutsAwaitingRelease } from "@/lib/dashboard-metrics";
import { Panel, PanelEmpty } from "./dashboard-panel";

/** แสดงสูงสุดกี่รายการต่อกลุ่ม (ที่เหลือไปดูที่หน้า Campaign) */
const MAX_ROWS = 4;

function rolloutHref(r: CampaignRollout) {
  return `/campaigns/${r.campaignId}/rollouts/${r.id}`;
}

/**
 * Rollout ที่ต้องรู้ตอนนี้: "รออนุมัติแล้วแต่ยังไม่ปล่อย" (งานค้างที่ไม่มีใครเห็น
 * ถ้าไม่เปิดหน้า Campaign) ขึ้นก่อน ตามด้วย "กำลังส่งให้อุปกรณ์" พร้อมความคืบหน้า
 * — ข้อมูลทั้งหมดมาจากรายการ Rollout ที่ Dashboard โหลดอยู่แล้ว ไม่ยิง API เพิ่ม
 */
export function DashboardRolloutsPanel({
  rollouts,
  campaigns,
  loading,
  error,
  onRetry,
  className,
}: {
  rollouts: CampaignRollout[] | null;
  campaigns: Campaign[] | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const nameOf = (id: string) =>
    campaigns?.find((c) => c.id === id)?.name ?? "กลุ่มอุปกรณ์";
  const awaiting = rollouts ? rolloutsAwaitingRelease(rollouts) : [];
  const active = rollouts ? activeRollouts(rollouts) : [];

  return (
    <Panel
      title="Rollout ที่กำลังดำเนินการ"
      href="/campaigns"
      className={className}
    >
      {error ? (
        <ErrorState message="โหลดไม่สำเร็จ" onRetry={onRetry} />
      ) : loading && rollouts === null ? (
        <Skeleton className="h-16 w-full" />
      ) : awaiting.length === 0 && active.length === 0 ? (
        <PanelEmpty>ไม่มี Rollout ที่รอปล่อยหรือกำลังส่งอยู่</PanelEmpty>
      ) : (
        <div className="flex flex-col gap-4">
          {awaiting.length > 0 && (
            <section aria-label="รอปล่อยเข้าอุปกรณ์">
              <p className="label-caps mb-1.5">
                อนุมัติแล้ว รอปล่อยเข้าอุปกรณ์ ({awaiting.length})
              </p>
              <ul className="flex flex-col divide-y rounded-lg border">
                {awaiting.slice(0, MAX_ROWS).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={rolloutHref(r)}
                      className="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-muted/60"
                    >
                      <StatusLed tone="warning" pulse />
                      <span className="min-w-0 flex-1 truncate">
                        {nameOf(r.campaignId)}
                      </span>
                      <span
                        data-tabular
                        className="text-xs text-muted-foreground"
                      >
                        {r.targetCount.toLocaleString("th-TH")} เครื่อง
                      </span>
                      <RelativeTime
                        iso={r.approvedAt ?? r.createdAt}
                        className="w-24 text-right text-xs text-muted-foreground"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {active.length > 0 && (
            <section aria-label="กำลังส่งให้อุปกรณ์">
              <p className="label-caps mb-1.5">
                กำลังส่งให้อุปกรณ์ ({active.length})
              </p>
              <ul className="flex flex-col gap-3">
                {active.slice(0, MAX_ROWS).map((r) => {
                  const done = r.successCount + r.failureCount;
                  return (
                    <li key={r.id}>
                      <Link
                        href={rolloutHref(r)}
                        className="group/row flex flex-col gap-1.5"
                      >
                        <span className="flex items-baseline gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate group-hover/row:underline">
                            {nameOf(r.campaignId)}
                          </span>
                          <span
                            data-tabular
                            className="text-xs text-muted-foreground tabular-nums"
                          >
                            {done}/{r.targetCount} เครื่อง
                            {r.failureCount > 0 && (
                              <span className="text-danger-foreground">
                                {" "}
                                (ล้มเหลว {r.failureCount})
                              </span>
                            )}
                          </span>
                        </span>
                        <SegmentBar
                          legend={false}
                          segments={[
                            {
                              key: "success",
                              label: "สำเร็จ",
                              value: r.successCount,
                              colorClass: "bg-success",
                            },
                            {
                              key: "failed",
                              label: "ล้มเหลว",
                              value: r.failureCount,
                              colorClass: "bg-destructive",
                            },
                            {
                              key: "pending",
                              label: "รอผล",
                              value: Math.max(r.targetCount - done, 0),
                              colorClass: "bg-transparent",
                            },
                          ]}
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}
