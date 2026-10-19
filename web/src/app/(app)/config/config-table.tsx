"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { SlidersHorizontalIcon } from "lucide-react";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import {
  dateRangeFilterFn,
  multiSelectFilterFn,
} from "@/components/data-table/filter-fns";
import { useConfigs } from "@/hooks/use-configs";
import { type Config } from "@/lib/config-api";
import { CONFIG_STATUS_TONE, StatusPill, statusLabel } from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui/notice";
import { CreateConfigButton } from "./create-config-button";
import { ImportConfigButton } from "./import-config-button";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";

/** เรียงชื่อแบบภาษาไทย (default text sort ของ TanStack เทียบ codepoint ล้วน) */
function thTextSort(a: Row<Config>, b: Row<Config>, columnId: string): number {
  return String(a.getValue(columnId)).localeCompare(
    String(b.getValue(columnId)),
    "th",
  );
}

const columns: ColumnDef<Config>[] = [
  {
    accessorKey: "name",
    header: "ชื่อ Config",
    sortingFn: thTextSort,
    meta: { filterVariant: "text", label: "ชื่อ" },
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "status",
    header: "สถานะ",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "สถานะ" },
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <StatusPill tone={CONFIG_STATUS_TONE[status] ?? "neutral"}>
          {statusLabel(status)}
        </StatusPill>
      );
    },
  },
  {
    accessorKey: "deviceModel",
    header: "โมเดล",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "โมเดล" },
  },
  {
    accessorKey: "protocol",
    header: "โปรโตคอล",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "โปรโตคอล" },
  },
  {
    accessorKey: "updatedAt",
    header: "แก้ไขล่าสุด",
    filterFn: dateRangeFilterFn,
    enableGlobalFilter: false,
    meta: { filterVariant: "date-range", label: "แก้ไขล่าสุด", align: "end" },
    cell: ({ row }) => (
      <span
        className="text-muted-foreground"
        title={formatDateTime(row.original.updatedAt)}
      >
        {formatRelativeTime(row.original.updatedAt)}
      </span>
    ),
  },
];

export function ConfigTableCard({
  title,
  description,
  justSavedId = null,
}: {
  /** หัวหน้าจอ render ที่นี่ (ไม่ใช่ page.tsx) เพราะปุ่ม Import ต้อง refetch
   *  ตารางของ component นี้หลัง import เสร็จ */
  title: string;
  description: string;
  justSavedId?: string | null;
}) {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useConfigs();
  const configs = useMemo(() => data ?? [], [data]);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  // "สร้างจาก Config Wizard" มาจาก URL (?saved=id, navigate จริง) — "นำเข้า
  // จากไฟล์" มาจาก Dialog (แก้ครั้งที่ 71) ไม่มีการ navigate เลยใช้ local
  // state แทน · local state ชนะถ้ามีค่าใหม่กว่า (import ล่าสุดหลังเปิดหน้ามา)
  const [localJustCreatedId, setLocalJustCreatedId] = useState<string | null>(
    null,
  );
  const effectiveJustSavedId = localJustCreatedId ?? justSavedId;

  const handleImported = useCallback(
    (config: { id: string }) => {
      setDismissedBanner(false);
      setLocalJustCreatedId(config.id);
      void refetch();
    },
    [refetch],
  );

  const savedConfig =
    effectiveJustSavedId != null
      ? configs.find((c) => c.id === effectiveJustSavedId) ?? null
      : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <ImportConfigButton onImported={handleImported} />
            <CreateConfigButton />
          </>
        }
      />
      {savedConfig && !dismissedBanner && (
        <Notice tone="success" onDismiss={() => setDismissedBanner(true)}>
          <span className="flex flex-wrap items-center gap-1">
            บันทึก Config &ldquo;{savedConfig.name}&rdquo; แล้ว สถานะ{" "}
            <StatusPill tone={CONFIG_STATUS_TONE[savedConfig.status] ?? "neutral"}>
              {statusLabel(savedConfig.status)}
            </StatusPill>
          </span>
        </Notice>
      )}
      <Card>
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
          ) : configs.length === 0 ? (
            <EmptyState
              icon={SlidersHorizontalIcon}
              message="ยังไม่มี Config ในระบบ"
              action={<CreateConfigButton />}
            />
          ) : (
            <DataTable
              columns={columns}
              data={configs}
              searchPlaceholder="ค้นหาชื่อ / โมเดล / โปรโตคอล…"
              emptyMessage="ไม่พบ Config ที่ตรงกับเงื่อนไข"
              onRowClick={(config) => router.push(`/config/${config.id}`)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
