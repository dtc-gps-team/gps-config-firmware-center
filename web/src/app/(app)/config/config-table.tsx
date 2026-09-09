"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";

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
import {
  dateRangeFilterFn,
  multiSelectFilterFn,
} from "@/components/data-table/filter-fns";
import { useConfigs } from "@/hooks/use-configs";
import { type Config } from "@/lib/config-api";
import { CONFIG_STATUS_TONE, pillClass } from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { ConfigDetailSheet } from "./config-detail-sheet";
import { CreateConfigButton } from "./create-config-button";

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
        <span className={pillClass(CONFIG_STATUS_TONE[status] ?? "neutral")}>
          {status}
        </span>
      );
    },
  },
  {
    accessorKey: "deviceModel",
    header: "รุ่นอุปกรณ์",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "รุ่น" },
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
  justSavedId = null,
}: {
  justSavedId?: string | null;
}) {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useConfigs();
  const configs = useMemo(() => data ?? [], [data]);
  const [selected, setSelected] = useState<Config | null>(null);
  const [dismissedBanner, setDismissedBanner] = useState(false);

  const savedConfig =
    justSavedId != null
      ? configs.find((c) => c.id === justSavedId) ?? null
      : null;

  return (
    <Card>
      {savedConfig && !dismissedBanner && (
        <div className="mx-6 -mb-2 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <span>
            บันทึก Config &ldquo;{savedConfig.name}&rdquo; แล้ว — สถานะ{" "}
            <strong>{savedConfig.status}</strong>
          </span>
          <button
            type="button"
            onClick={() => setDismissedBanner(true)}
            className="shrink-0 text-xs underline"
          >
            ปิด
          </button>
        </div>
      )}
      <CardHeader>
        <CardTitle>รายการ Config</CardTitle>
        <CardDescription>
          ทุก Role ที่ login แล้วดูได้ · คลิกแถวเพื่อดูรายละเอียด
        </CardDescription>
        <CardAction>
          <CreateConfigButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading && data === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            กำลังโหลด…
          </p>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : configs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            ยังไม่มี Config ในระบบ
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={configs}
            searchPlaceholder="ค้นหาชื่อ / รุ่น / โปรโตคอล…"
            emptyMessage="ไม่พบ Config ที่ตรงกับเงื่อนไข"
            onRowClick={setSelected}
          />
        )}
      </CardContent>

      <ConfigDetailSheet
        config={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onEdit={(config) => {
          setSelected(null);
          router.push(`/config/${config.id}/edit`);
        }}
        onDeleted={() => {
          setSelected(null);
          void refetch();
        }}
      />
    </Card>
  );
}
