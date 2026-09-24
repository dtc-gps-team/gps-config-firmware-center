"use client";

import { useRouter } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { MegaphoneIcon } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useCampaigns } from "@/hooks/use-campaigns";
import { type Campaign } from "@/lib/campaign-api";
import { CreateCampaignButton } from "./create-campaign-button";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";

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
    accessorKey: "description",
    header: "คำอธิบาย",
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.description ?? "—"}
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

/** การ์ดรายการแคมเปญ — ต่อ `GET /campaigns` จริง (Sprint 3 #21) ทุก Role
 * ที่ login แล้วดูได้ (resource `campaign` action `Read`) · ใช้ `DataTable`
 * กลางเดียวกับ config-table/firmware-table (ค้นหารวม + ฟิลเตอร์ต่อคอลัมน์ +
 * เรียงลำดับ) · Card + CardAction (ปุ่ม "สร้างแคมเปญ") เป็นเจ้าของโดย
 * component นี้เอง mirror `ConfigTableCard`/`FirmwareTableCard` (เดิมปุ่ม
 * สร้างอยู่นอก Card ที่ page.tsx แยกจากอีก 2 หน้า) */
export function CampaignsTableCard() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useCampaigns();

  return (
    <Card>
      <CardHeader>
        <CardTitle>รายการแคมเปญ</CardTitle>
        <CardDescription>ทุก Role ที่ login แล้วดูได้</CardDescription>
        <CardAction>
          <CreateCampaignButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading && data === null ? (
          <TableSkeleton columns={columns.length} />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={MegaphoneIcon}
            message="ยังไม่มีแคมเปญ"
            action={<CreateCampaignButton />}
          />
        ) : (
          <DataTable
            columns={columns}
            data={data}
            searchPlaceholder="ค้นหาชื่อแคมเปญ…"
            emptyMessage="ไม่พบแคมเปญที่ตรงกับเงื่อนไข"
            onRowClick={(campaign) => router.push(`/campaigns/${campaign.id}`)}
          />
        )}
      </CardContent>
    </Card>
  );
}
