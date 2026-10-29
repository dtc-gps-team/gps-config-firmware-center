"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { LayersIcon, PlusIcon } from "lucide-react";

import { RoleGuard } from "@/components/auth/role-guard";
import { canManageDeviceModels } from "@/lib/permissions";
import { type DeviceModel } from "@/lib/device-model-api";
import { useDeviceModels } from "@/hooks/use-device-models";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { StatusPill, DEVICE_MODEL_STATUS_TONE } from "@/lib/status-pill";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { RefreshControl } from "@/components/refresh-control";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui/notice";
import { DeviceModelRowActions } from "./device-model-row-actions";
import { CreateDeviceModelForm } from "./create-device-model-form";

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
export function DeviceModelManagementView() {
  const { data, isLoading, error, refetch } = useDeviceModels();
  const modelList = useMemo(() => data ?? [], [data]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<DeviceModel | null>(null);

  const handleUpdated = useCallback(() => void refetch(), [refetch]);

  const handleCreated = useCallback(
    (model: DeviceModel) => {
      setDialogOpen(false);
      setJustCreated(model);
      void refetch();
    },
    [refetch],
  );

  const columns: ColumnDef<DeviceModel>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "โมเดล",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "โมเดล" },
        cell: ({ row }) => (
          <span className="font-instrument text-sm">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "manufacturer",
        header: "ผู้ผลิต",
        sortingFn: thTextSort,
        meta: { filterVariant: "text", label: "ผู้ผลิต" },
        cell: ({ row }) => row.original.manufacturer ?? "-",
      },
      {
        id: "supportedProtocols",
        header: "โปรโตคอล",
        enableSorting: false,
        accessorFn: (row) => row.supportedProtocols.join(", "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.supportedProtocols.map((p) => (
              <span
                key={p}
                className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
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
        cell: ({ row }) => row.original.warrantyMonths ?? "-",
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
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Device Model"
          description="ทะเบียนโมเดลอุปกรณ์และ protocol ที่รองรับ ใช้เป็นตัวเลือกตอนสร้าง Config, Parameter และลงทะเบียนอุปกรณ์"
          actions={
            <>
              <RefreshControl />
              <Button onClick={() => setDialogOpen(true)}>
                <PlusIcon />
                เพิ่มโมเดล
              </Button>
            </>
          }
        />

        {justCreated && (
          <Notice tone="success">
            เพิ่มโมเดล &ldquo;{justCreated.name}&rdquo; แล้ว
          </Notice>
        )}

        {isLoading && data === null ? (
          <TableSkeleton columns={columns.length} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : modelList.length === 0 ? (
          <EmptyState
            icon={LayersIcon}
            message="ยังไม่มีโมเดลในทะเบียน"
            action={
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <PlusIcon />
                เพิ่มโมเดล
              </Button>
            }
          />
        ) : (
          <DataTable
            urlSync
            columns={columns}
            data={modelList}
            searchPlaceholder="ค้นหาโมเดล / ผู้ผลิต…"
            emptyMessage="ไม่พบโมเดลที่ตรงกับเงื่อนไข"
          />
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มโมเดลใหม่</DialogTitle>
            <DialogDescription>
              ชื่อโมเดลต้องตรงกับที่ใช้อยู่แล้วเป๊ะ (ถ้ามี) เพราะเปลี่ยนชื่อ
              ทีหลังไม่ได้
            </DialogDescription>
          </DialogHeader>
          <CreateDeviceModelForm onCreated={handleCreated} />
        </DialogContent>
      </Dialog>
    </RoleGuard>
  );
}
