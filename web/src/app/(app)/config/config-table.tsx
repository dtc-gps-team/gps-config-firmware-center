"use client";

import { useMemo, useState } from "react";
import type { ColumnDef, Row } from "@tanstack/react-table";

import {
  Card,
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

export function ConfigTableCard() {
  const { data, isLoading, error, refetch } = useConfigs();
  const configs = useMemo(() => data ?? [], [data]);
  const [selected, setSelected] = useState<Config | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>รายการ Config</CardTitle>
        <CardDescription>
          ทุก Role ที่ login แล้วดูได้ · คลิกแถวเพื่อดูรายละเอียด
        </CardDescription>
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
        onDeleted={() => {
          setSelected(null);
          void refetch();
        }}
      />
    </Card>
  );
}
