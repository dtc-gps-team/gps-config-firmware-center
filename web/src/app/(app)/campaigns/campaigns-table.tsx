"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { CAMPAIGN_STATUS_TONE, StatusPill, statusLabel } from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useCampaigns } from "@/hooks/use-campaigns";
import { type Campaign } from "@/lib/campaign-api";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";

/** เรียงชื่อแบบภาษาไทย (default text sort ของ TanStack เทียบ codepoint ล้วน) —
 * mirror `config-table.tsx`/`firmware-table.tsx` */
function thTextSort(a: Row<Campaign>, b: Row<Campaign>, columnId: string): number {
  return String(a.getValue(columnId)).localeCompare(
    String(b.getValue(columnId)),
    "th",
  );
}

const columns: ColumnDef<Campaign>[] = [
  {
    accessorKey: "name",
    header: "ชื่อแคมเปญ",
    sortingFn: thTextSort,
    meta: { filterVariant: "text", label: "ชื่อ" },
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "payloadType",
    header: "ประเภท",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "ประเภท" },
  },
  {
    accessorKey: "status",
    header: "สถานะ",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "สถานะ" },
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <StatusPill tone={CAMPAIGN_STATUS_TONE[status] ?? "neutral"}>
          {statusLabel(status)}
        </StatusPill>
      );
    },
  },
  {
    accessorKey: "targetCount",
    header: "จำนวนเป้าหมาย",
    enableGlobalFilter: false,
    meta: { align: "end" },
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.targetCount}
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

/** ตารางรายการแคมเปญ — ต่อ `GET /campaigns` จริง (Sprint 3 #21) ทุก Role
 * ที่ login แล้วดูได้ (resource `campaign` action `Read`) · ใช้ `DataTable`
 * กลางเดียวกับ config-table/firmware-table (ค้นหารวม + ฟิลเตอร์ต่อคอลัมน์ +
 * เรียงลำดับ) แทนตารางดิบเดิม เพื่อให้ 3 หน้ารายการ (Config/Firmware/Campaign)
 * ใช้งานสอดคล้องกัน */
export function CampaignsTable() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useCampaigns();

  if (isLoading && !data) {
    return <TableSkeleton columns={columns.length} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        ยังไม่มีแคมเปญ
      </p>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="ค้นหาชื่อแคมเปญ…"
      emptyMessage="ไม่พบแคมเปญที่ตรงกับเงื่อนไข"
      onRowClick={(campaign) => router.push(`/campaigns/${campaign.id}`)}
    />
  );
}
