"use client";

import { useMemo } from "react";

import { ErrorState } from "@/components/error-state";
import { SegmentBar, type Segment } from "@/components/segment-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfigs } from "@/hooks/use-configs";
import { CONFIG_STATUSES, type ConfigStatus } from "@/lib/config-api";
import { statusLabel } from "@/lib/status-pill";

/**
 * แท่งสัดส่วน Config ทั้งหมดแยกตามสถานะ — เลือกแท่งซ้อนแทน pie/donut ตาม
 * หลักเกณฑ์ part-to-whole · สีผูกกับความหมายของสถานะ (token เท่านั้น):
 * draft เทา, testing อำพัน (รอ), approved เขียว, rejected แดง, synced น้ำเงิน
 * ลำดับคงที่ตาม `CONFIG_STATUSES` เสมอ ไม่สลับตามจำนวน
 */
const SEGMENT_COLOR: Record<ConfigStatus, string> = {
  draft: "bg-muted-foreground/40",
  testing: "bg-warning",
  approved: "bg-success",
  rejected: "bg-destructive",
  synced: "bg-info",
};

export function DashboardConfigStatusChart() {
  const { data, isLoading, error, refetch } = useConfigs();

  const segments = useMemo<Segment[]>(() => {
    const counts = Object.fromEntries(
      CONFIG_STATUSES.map((status) => [status, 0]),
    ) as Record<ConfigStatus, number>;
    for (const config of data ?? []) {
      counts[config.status] = (counts[config.status] ?? 0) + 1;
    }
    return CONFIG_STATUSES.map((status) => ({
      key: status,
      label: statusLabel(status),
      value: counts[status],
      colorClass: SEGMENT_COLOR[status],
    }));
  }, [data]);

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">สถานะ Config โดยรวม</CardTitle>
        <CardDescription>
          สัดส่วน Config ทั้งหมดในระบบแยกตามสถานะ (
          {total.toLocaleString("th-TH")} รายการ)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : isLoading && total === 0 ? (
          <Skeleton className="h-10 w-full" />
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มี Config ในระบบ</p>
        ) : (
          <SegmentBar segments={segments} />
        )}
      </CardContent>
    </Card>
  );
}
