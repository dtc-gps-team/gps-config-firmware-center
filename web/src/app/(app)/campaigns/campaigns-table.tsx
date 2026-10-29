"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { MegaphoneIcon } from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { DataTable } from "@/components/data-table/data-table";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useCampaigns } from "@/hooks/use-campaigns";
import { type Campaign } from "@/lib/campaign-api";
import { canReadCampaign } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { CreateCampaignButton } from "./create-campaign-button";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { RefreshControl } from "@/components/refresh-control";

/** เรียงชื่อแบบภาษาไทย (default text sort ของ TanStack เทียบ codepoint ล้วน) —
 * mirror `config-table.tsx`/`firmware-table.tsx` */
function thTextSort(
  a: Row<Campaign>,
  b: Row<Campaign>,
  columnId: string,
): number {
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
    accessorKey: "description",
    header: "คำอธิบาย",
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.description ?? "-"}
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
  const { data, isLoading, error, refetch } = useCampaigns();

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
            onRowClick={(campaign) => router.push(`/campaigns/${campaign.id}`)}
          />
        )}
      </div>
    </RoleGuard>
  );
}
