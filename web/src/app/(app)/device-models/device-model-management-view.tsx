"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { LayersIcon } from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { canManageDeviceModels } from "@/lib/permissions";
import { type DeviceModel } from "@/lib/device-model-api";
import { useDeviceModels } from "@/hooks/use-device-models";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { StatusPill, DEVICE_MODEL_STATUS_TONE } from "@/lib/status-pill";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { DeviceModelRowActions } from "./device-model-row-actions";

function thTextSort(
  a: Row<DeviceModel>,
  b: Row<DeviceModel>,
  columnId: string,
): number {
  return String(a.getValue(columnId)).localeCompare(
    String(b.getValue(columnId)),
    "th",
  );
}

/**
 * เนื้อหาจริงของหน้า DeviceModel Management — แยกเป็น client component
 * ต่างหากจาก page.tsx เพราะ RoleGuard ต้องใช้ useAuth() (client-only hook)
 * mirror `user-management-view.tsx` ทุกประการ
 *
 * ปิด gap ที่เดิมมีแค่ backend (issue #209) แต่ไม่มี Web UI ให้ Admin ใช้เลย
 * — เพิ่ม/แก้รุ่นต้องยิง API ตรงๆ มาตลอด ตั้งแต่ #209 merge
 */
export function DeviceModelManagementView({
  justCreatedId = null,
}: {
  justCreatedId?: string | null;
}) {
  const { data, isLoading, error, refetch } = useDeviceModels();
  const modelList = useMemo(() => data ?? [], [data]);

  const justCreated =
    justCreatedId != null
      ? modelList.find((m) => m.id === justCreatedId) ?? null
      : null;

  const handleUpdated = useCallback(() => void refetch(), [refetch]);

  const columns: ColumnDef<DeviceModel>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "รุ่นอุปกรณ์",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "รุ่นอุปกรณ์" },
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "manufacturer",
        header: "ผู้ผลิต",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "ผู้ผลิต" },
        cell: ({ row }) => row.original.manufacturer ?? "—",
      },
      {
        id: "supportedProtocols",
        header: "Protocol ที่รองรับ",
        enableSorting: false,
        accessorFn: (row) => row.supportedProtocols.join(", "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.supportedProtocols.map((p) => (
              <span
                key={p}
                className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {p}
              </span>
            ))}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "สถานะ",
        filterFn: multiSelectFilterFn,
        meta: { filterVariant: "multi-select", label: "สถานะ" },
        cell: ({ row }) => (
          <StatusPill tone={DEVICE_MODEL_STATUS_TONE[row.original.status]}>
            {row.original.status === "active" ? "ยังผลิตอยู่" : "เลิกผลิตแล้ว"}
          </StatusPill>
        ),
      },
      {
        accessorKey: "warrantyMonths",
        header: "รับประกัน (เดือน)",
        cell: ({ row }) => row.original.warrantyMonths ?? "—",
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <DeviceModelRowActions
            model={row.original}
            onUpdated={handleUpdated}
          />
        ),
      },
    ],
    [handleUpdated],
  );

  return (
    <RoleGuard allow={canManageDeviceModels}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Device Model Management</h1>
          <p className="text-sm text-muted-foreground">
            ทะเบียนรุ่นอุปกรณ์ + protocol ที่รองรับ — ใช้ทำ dropdown ตอนสร้าง
            Config/Parameter/ลงทะเบียนอุปกรณ์ทั่วทั้งระบบ
          </p>
        </div>

        <Card>
          {justCreated && (
            <div className="mx-6 -mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              เพิ่มรุ่นอุปกรณ์ &ldquo;{justCreated.name}&rdquo; แล้ว
            </div>
          )}
          <CardHeader>
            <CardTitle>รุ่นอุปกรณ์ทั้งหมด</CardTitle>
            <CardDescription>รวมรุ่นที่เลิกผลิตแล้ว</CardDescription>
            <CardAction className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
              >
                รีเฟรช
              </Button>
              <Link
                href="/device-models/new"
                className={buttonVariants({ size: "sm" })}
              >
                + เพิ่มรุ่นอุปกรณ์
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {isLoading && data === null ? (
              <TableSkeleton columns={columns.length} />
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                >
                  ลองใหม่
                </Button>
              </div>
            ) : modelList.length === 0 ? (
              <EmptyState
                icon={LayersIcon}
                message="ยังไม่มีรุ่นอุปกรณ์ในทะเบียน"
                action={
                  <Link
                    href="/device-models/new"
                    className={buttonVariants({ size: "sm" })}
                  >
                    + เพิ่มรุ่นอุปกรณ์
                  </Link>
                }
              />
            ) : (
              <DataTable
                columns={columns}
                data={modelList}
                searchPlaceholder="ค้นหารุ่น / ผู้ผลิต…"
                emptyMessage="ไม่พบรุ่นอุปกรณ์ที่ตรงกับเงื่อนไข"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
