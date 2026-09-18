"use client";

import { useMemo } from "react";
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
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { useFirmwareList } from "@/hooks/use-firmware";
import { type Firmware } from "@/lib/firmware-api";
import {
  FIRMWARE_APPROVAL_STATUS_TONE,
  FIRMWARE_DEVICE_UPDATE_STATUS_TONE,
  FIRMWARE_UPLOAD_STATUS_TONE,
  pillClass,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { formatFileSize } from "@/lib/format-bytes";
import { UploadFirmwareButton } from "./upload-firmware-button";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";

function thTextSort(a: Row<Firmware>, b: Row<Firmware>, columnId: string): number {
  return String(a.getValue(columnId)).localeCompare(
    String(b.getValue(columnId)),
    "th",
  );
}

const columns: ColumnDef<Firmware>[] = [
  {
    accessorKey: "version",
    header: "เวอร์ชัน",
    sortingFn: thTextSort,
    meta: { filterVariant: "text", label: "เวอร์ชัน" },
    cell: ({ row }) => (
      <span className="font-mono text-sm font-medium">
        {row.original.version}
      </span>
    ),
  },
  {
    id: "compatibility",
    accessorFn: (row) => row.deviceModelCompatibility.join(", "),
    header: "รุ่นอุปกรณ์ที่รองรับ",
    meta: { filterVariant: "text", label: "รุ่นที่รองรับ" },
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.deviceModelCompatibility.map((m) => (
          <span key={m} className={pillClass("neutral")}>
            {m}
          </span>
        ))}
      </div>
    ),
  },
  {
    accessorKey: "uploadStatus",
    header: "สถานะอัปโหลด",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "สถานะอัปโหลด" },
    cell: ({ row }) => {
      const status = row.original.uploadStatus;
      return (
        <StatusPill tone={FIRMWARE_UPLOAD_STATUS_TONE[status] ?? "neutral"}>
          {statusLabel(status)}
        </StatusPill>
      );
    },
  },
  {
    accessorKey: "approvalStatus",
    header: "สถานะอนุมัติคุณภาพ",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "สถานะอนุมัติคุณภาพ" },
    cell: ({ row }) => {
      const status = row.original.approvalStatus;
      return (
        <StatusPill tone={FIRMWARE_APPROVAL_STATUS_TONE[status] ?? "neutral"}>
          {statusLabel(status)}
        </StatusPill>
      );
    },
  },
  {
    accessorKey: "deviceUpdateStatus",
    header: "สถานะอัปเดตกล่อง",
    filterFn: multiSelectFilterFn,
    meta: { filterVariant: "multi-select", label: "สถานะอัปเดตกล่อง" },
    cell: ({ row }) => {
      const status = row.original.deviceUpdateStatus;
      return (
        <StatusPill
          tone={FIRMWARE_DEVICE_UPDATE_STATUS_TONE[status] ?? "neutral"}
        >
          {status}
        </StatusPill>
      );
    },
  },
  {
    accessorKey: "fileSizeBytes",
    header: "ขนาดไฟล์",
    enableGlobalFilter: false,
    meta: { align: "end" },
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {formatFileSize(row.original.fileSizeBytes)}
      </span>
    ),
  },
  {
    accessorKey: "uploadedAt",
    header: "อัปโหลดเมื่อ",
    enableGlobalFilter: false,
    meta: { align: "end" },
    cell: ({ row }) => (
      <span
        className="text-muted-foreground"
        title={formatDateTime(row.original.uploadedAt)}
      >
        {formatRelativeTime(row.original.uploadedAt)}
      </span>
    ),
  },
];

export function FirmwareTableCard({
  justUploadedId = null,
}: {
  justUploadedId?: string | null;
}) {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useFirmwareList();
  const firmwareList = useMemo(() => data ?? [], [data]);

  const justUploaded =
    justUploadedId != null
      ? firmwareList.find((f) => f.id === justUploadedId) ?? null
      : null;

  return (
    <Card>
      {justUploaded && (
        <div className="mx-6 -mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          อัปโหลด Firmware เวอร์ชัน &ldquo;{justUploaded.version}&rdquo; แล้ว —
          สถานะ{" "}
          <StatusPill tone={FIRMWARE_UPLOAD_STATUS_TONE[justUploaded.uploadStatus] ?? "neutral"}>
            {statusLabel(justUploaded.uploadStatus)}
          </StatusPill>
        </div>
      )}
      <CardHeader>
        <CardTitle>รายการ Firmware</CardTitle>
        <CardDescription>
          ทุก Role ที่ login แล้วดูได้ · คลิกแถวเพื่อดูรายละเอียด/แก้
          Compatibility Tag/ทดสอบ
        </CardDescription>
        <CardAction>
          <UploadFirmwareButton />
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
        ) : firmwareList.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            ยังไม่มี Firmware ในระบบ
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={firmwareList}
            searchPlaceholder="ค้นหาเวอร์ชัน / รุ่นอุปกรณ์…"
            emptyMessage="ไม่พบ Firmware ที่ตรงกับเงื่อนไข"
            onRowClick={(fw) => router.push(`/firmware/${fw.id}`)}
          />
        )}
      </CardContent>
    </Card>
  );
}
