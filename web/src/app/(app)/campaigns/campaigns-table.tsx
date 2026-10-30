"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { MegaphoneIcon } from "lucide-react";

import { useMemo } from "react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DataTable } from "@/components/data-table/data-table";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useCampaigns } from "@/hooks/use-campaigns";
import { useAllCampaignRollouts } from "@/hooks/use-all-campaign-rollouts";
import { type Campaign, type CampaignRollout } from "@/lib/campaign-api";
import {
  CAMPAIGN_ROLLOUT_STATUS_TONE,
  StatusPill,
  rolloutStatusLabel,
} from "@/lib/status-pill";
import { StatusLed } from "@/components/ui/status-led";
import { canReadCampaign } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CreateCampaignButton } from "./create-campaign-button";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { RefreshControl } from "@/components/refresh-control";

/** แถวของตาราง: กลุ่มพร้อม Rollout ล่าสุด (ถ้ามี) และจำนวนรอบทั้งหมด */
type CampaignRow = Campaign & {
  latest: CampaignRollout | null;
  rolloutCount: number;
};

/** สถานะ Rollout ที่รอคนลงมือ: รออนุมัติ, รอปล่อย, หยุดเอง */
const ATTENTION_STATUSES = ["pending_approval", "approved", "paused"];

function thSort(a: Row<CampaignRow>, b: Row<CampaignRow>, id: string): number {
  return String(a.getValue(id)).localeCompare(String(b.getValue(id)), "th");
}

const columns: ColumnDef<CampaignRow>[] = [
  {
    accessorKey: "name",
    header: "ชื่อแคมเปญ",
    sortingFn: thSort,
    meta: { filterVariant: "text", label: "ชื่อ" },
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{row.original.name}</span>
        {row.original.description && (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {row.original.description}
          </span>
        )}
      </div>
    ),
  },
  {
    id: "latestStatus",
    header: "Rollout ล่าสุด",
    accessorFn: (c) => c.latest?.status ?? "",
    enableGlobalFilter: false,
    cell: ({ row }) => {
      const r = row.original.latest;
      if (!r)
        return (
          <span className="text-muted-foreground">ยังไม่เคย Roll out</span>
        );
      return (
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            tone={CAMPAIGN_ROLLOUT_STATUS_TONE[r.status] ?? "neutral"}
          >
            {rolloutStatusLabel(r.status)}
          </StatusPill>
          <span className="text-xs text-muted-foreground">{r.payloadType}</span>
        </div>
      );
    },
  },
  {
    id: "result",
    header: "ผลรายเครื่อง",
    accessorFn: (c) => c.latest?.successCount ?? 0,
    enableGlobalFilter: false,
    cell: ({ row }) => {
      const r = row.original.latest;
      if (!r || r.targetCount === 0)
        return <span className="text-muted-foreground">-</span>;
      const pct = (n: number) => `${(n / r.targetCount) * 100}%`;
      return (
        <div className="flex min-w-36 flex-col gap-1">
          <div
            role="img"
            aria-label={`สำเร็จ ${r.successCount} ล้มเหลว ${r.failureCount} จาก ${r.targetCount} เครื่อง`}
            className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted"
          >
            <div
              className="bg-success"
              style={{ width: pct(r.successCount) }}
            />
            <div
              className="bg-destructive"
              style={{ width: pct(r.failureCount) }}
            />
          </div>
          <span className="font-instrument text-xs tabular-nums text-muted-foreground">
            <span className="text-success-foreground">{r.successCount}</span>
            {" / "}
            <span className="text-danger-foreground">{r.failureCount}</span>
            {" / "}
            {r.targetCount}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "rolloutCount",
    header: "รอบ",
    enableGlobalFilter: false,
    meta: { align: "end" },
    cell: ({ row }) => (
      <span className="font-instrument tabular-nums">
        {row.original.rolloutCount}
      </span>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "สร้างเมื่อ",
    enableGlobalFilter: false,
    meta: { align: "end" },
    cell: ({ row }) => (
      <span
        className="text-muted-foreground"
        title={formatDateTime(row.original.createdAt)}
      >
        {formatRelativeTime(row.original.createdAt)}
      </span>
    ),
  },
];

/** การ์ดรายการแคมเปญ — ต่อ `GET /campaigns` จริง (Sprint 3 #21) resource
 * `campaign` action `Read` — **ไม่ใช่ทุก Role**: FirmwareEngineer/QAEngineer
 * เป็น "-" ตาม RBAC_Matrix.md §2 แถว "Campaign Wizard" (`seed.ts` ไม่ grant
 * ให้ 2 role นี้) ใช้ `RoleGuard` กันทั้งหน้าเหมือน Audit Log/User Management
 * แทนปล่อยให้ยิง request แล้วได้ error 403 ดิบๆ (รีวิว #373 B บน Dashboard
 * พบเคสเดียวกัน — ดู `dashboard-summary.tsx`) · ใช้ `DataTable` กลางเดียวกับ
 * config-table/firmware-table (ค้นหารวม + ฟิลเตอร์ต่อคอลัมน์ + เรียงลำดับ) ·
 * หัวหน้าจอ (PageHeader + ปุ่ม "สร้างแคมเปญ") เป็นเจ้าของโดย component นี้เอง
 * mirror `ConfigTableCard`/`FirmwareTableCard` */
export function CampaignsTableCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const router = useRouter();
  const { data: campaigns, isLoading, error, refetch } = useCampaigns();
  const rolloutsQuery = useAllCampaignRollouts();
  const data = useMemo<CampaignRow[] | null>(() => {
    if (!campaigns) return null;
    const byCampaign = new Map<string, CampaignRollout[]>();
    for (const r of rolloutsQuery.data ?? []) {
      byCampaign.set(r.campaignId, [
        ...(byCampaign.get(r.campaignId) ?? []),
        r,
      ]);
    }
    return campaigns.map((c) => {
      const list = byCampaign.get(c.id) ?? [];
      const latest =
        [...list].sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] ??
        null;
      return { ...c, latest, rolloutCount: list.length };
    });
  }, [campaigns, rolloutsQuery.data]);
  const attention = (data ?? []).filter(
    (c) => c.latest && ATTENTION_STATUSES.includes(c.latest.status),
  );

  return (
    <RoleGuard allow={canReadCampaign}>
      <div className="flex flex-col gap-5">
        <PageHeader
          title={title}
          description={description}
          actions={
            <>
              <RefreshControl />
              <CreateCampaignButton />
            </>
          }
        />
        {attention.length > 0 && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-2.5 text-sm text-warning-foreground"
          >
            <span className="inline-flex items-center gap-2 font-medium">
              <StatusLed tone="warning" pulse />
              {attention.length} กลุ่มรอดำเนินการ
            </span>
            <span className="text-warning-foreground/80">
              {attention
                .map((c) => c.name)
                .slice(0, 3)
                .join(", ")}
              {attention.length > 3 && ` และอีก ${attention.length - 3} กลุ่ม`}
            </span>
          </div>
        )}
        <Card>
          <CardContent>
            {isLoading && data === null ? (
              <TableSkeleton columns={columns.length} />
            ) : error ? (
              <ErrorState message={error} onRetry={() => void refetch()} />
            ) : !data || data.length === 0 ? (
              <EmptyState
                icon={MegaphoneIcon}
                message="ยังไม่มีแคมเปญ สร้างกลุ่มอุปกรณ์แรกเพื่อเริ่มติดตามและปล่อย Rollout"
                action={<CreateCampaignButton />}
              />
            ) : (
              <DataTable
                columns={columns}
                data={data}
                urlSync
                searchPlaceholder="ค้นหาชื่อแคมเปญ…"
                emptyMessage="ไม่พบแคมเปญที่ตรงกับเงื่อนไข"
                onRowClick={(campaign) =>
                  router.push(`/campaigns/${campaign.id}`)
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
