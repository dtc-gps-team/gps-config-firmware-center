"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
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
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { useDevices } from "@/hooks/use-devices";
import { type Device } from "@/lib/device-api";
import { DEVICE_STATUS_TONE, pillClass } from "@/lib/status-pill";

function textSort(a: Row<Device>, b: Row<Device>, columnId: string): number {
  return String(a.getValue(columnId)).localeCompare(String(b.getValue(columnId)));
}

const columns: ColumnDef<Device>[] = [
  {
    accessorKey: "deviceId",
    header: "Device ID",
    sortingFn: textSort,
    meta: { filterVariant: "text", label: "Device ID" },
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.deviceId}</span>
    ),
  },
  {
    accessorKey: "simNumber",
    header: "SIM",
    meta: { filterVariant: "text", label: "SIM" },
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground">
        {row.original.simNumber}
      </span>
    ),
  },
  {
    accessorKey: "deviceModel",
    header: "รุ่น",
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
    accessorKey: "status",
    header: "สถานะ",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "สถานะ" },
    cell: ({ row }) => (
      <span
        className={pillClass(DEVICE_STATUS_TONE[row.original.status] ?? "neutral")}
      >
        {row.original.status}
      </span>
    ),
  },
];

export function DeviceSearchView() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useDevices();
  const devices = useMemo(() => data ?? [], [data]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Device Search</h1>
        <p className="text-sm text-muted-foreground">
          ทุก Role เข้าถึงได้ (Read-only) · คลิกแถวเพื่อดูรายละเอียด
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการอุปกรณ์</CardTitle>
          <CardDescription>
            ค้นด้วย Device ID หรือ SIM · กรองตามรุ่น / โปรโตคอล / สถานะ
            {data ? ` · ${data.length} เครื่อง` : ""}
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
          ) : devices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              ยังไม่มีอุปกรณ์ในระบบ
            </p>
          ) : (
            <DataTable
              columns={columns}
              data={devices}
              searchPlaceholder="ค้นหา Device ID / SIM…"
              emptyMessage="ไม่พบอุปกรณ์ที่ตรงกับเงื่อนไข"
              onRowClick={(device) =>
                router.push(`/devices/${encodeURIComponent(device.deviceId)}`)
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
