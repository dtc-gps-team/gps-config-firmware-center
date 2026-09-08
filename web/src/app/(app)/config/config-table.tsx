"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { useConfigs } from "@/hooks/use-configs";
import { type Config } from "@/lib/config-api";
import { CONFIG_STATUS_TONE, pillClass } from "@/lib/status-pill";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const columns: ColumnDef<Config>[] = [
  {
    accessorKey: "name",
    header: "ชื่อ Config",
    meta: { filterVariant: "text", label: "ชื่อ" },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "deviceModel",
    header: "รุ่นอุปกรณ์",
    filterFn: "equalsString",
    meta: { filterVariant: "select", label: "รุ่น" },
  },
  {
    accessorKey: "protocol",
    header: "โปรโตคอล",
    filterFn: "equalsString",
    meta: { filterVariant: "select", label: "โปรโตคอล" },
  },
  {
    accessorKey: "status",
    header: "สถานะ",
    filterFn: "equalsString",
    meta: { filterVariant: "select", label: "สถานะ" },
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
    accessorKey: "updatedAt",
    header: "แก้ไขล่าสุด",
    enableColumnFilter: false,
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDateTime(row.original.updatedAt)}
      </span>
    ),
  },
];

export function ConfigTableCard() {
  const { data, isLoading, error, refetch } = useConfigs();
  const configs = useMemo(() => data ?? [], [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>รายการ Config</CardTitle>
        <CardDescription>
          ทุก Role ที่ login แล้วดูได้ · ค้นหารวมหรือกรองต่อคอลัมน์ได้
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
          />
        )}
      </CardContent>
    </Card>
  );
}
