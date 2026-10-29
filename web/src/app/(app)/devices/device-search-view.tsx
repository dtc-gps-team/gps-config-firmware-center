"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef, Row } from "@tanstack/react-table";
import {
  BoxIcon,
  DownloadIcon,
  HistoryIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { useAuth } from "@/components/auth/auth-provider";
import { CopyButton } from "@/components/copy-button";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { ErrorState } from "@/components/error-state";
import { canReadFirmware, canRegisterDevice } from "@/lib/permissions";
import { useCentralDevices } from "@/hooks/use-central-devices";
import { useDevices } from "@/hooks/use-devices";
import { useFirmwareList } from "@/hooks/use-firmware";
import type { CentralDevice } from "@/lib/central-device-api";
import { onlineByDeviceId } from "@/lib/central-device-display";
import { type Device } from "@/lib/device-api";
import {
  isFirmwareOutdated,
  latestApprovedByModel,
} from "@/lib/firmware-staleness";
import type { Firmware } from "@/lib/firmware-api";
import { DEVICE_STATUS_TONE, StatusPill, statusLabel } from "@/lib/status-pill";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

function textSort(a: Row<Device>, b: Row<Device>, columnId: string): number {
  return String(a.getValue(columnId)).localeCompare(String(b.getValue(columnId)));
}

const CONNECTION_UNKNOWN = "ไม่ทราบ";

/** คอลัมน์ "การเชื่อมต่อ" จาก Server กลาง — เครื่องที่ Server กลางไม่รู้จัก
 * (หรือติดต่อ Server กลางไม่ได้) แสดง "ไม่ทราบ" ไม่เดาว่าออฟไลน์ */
function connectionLabel(central: CentralDevice | undefined): string {
  if (!central) return CONNECTION_UNKNOWN;
  return central.online ? "ออนไลน์" : "ออฟไลน์";
}

function ConnectionBadge({ central }: { central: CentralDevice | undefined }) {
  if (!central) {
    return <span className="text-muted-foreground">{CONNECTION_UNKNOWN}</span>;
  }
  return (
    <StatusBadge tone={central.online ? "online" : "offline"} pulse={central.online}>
      {connectionLabel(central)}
    </StatusBadge>
  );
}

function FirmwareCell({
  central,
  latest,
}: {
  central: CentralDevice | undefined;
  latest: Firmware | undefined;
}) {
  const version = central?.reportedFirmwareVersion;
  if (!version) return <span className="text-muted-foreground">-</span>;
  const outdated = isFirmwareOutdated(version, latest);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-instrument text-sm">{version}</span>
      {outdated && latest && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-1.5 py-0.5 text-xs font-medium text-warning-foreground">
                <TriangleAlertIcon className="size-3" />
                ล้าสมัย
              </span>
            }
          />
          <TooltipContent>
            ล่าสุดที่อนุมัติ {latest.version}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

function buildColumns(
  centralById: Map<string, CentralDevice>,
  latestFirmware: Map<string, Firmware>,
): ColumnDef<Device>[] {
  return [
    {
      accessorKey: "deviceId",
      header: "Device ID",
      sortingFn: textSort,
      meta: { filterVariant: "text", label: "Device ID" },
      cell: ({ row }) => (
        <span className="font-instrument text-sm">{row.original.deviceId}</span>
      ),
    },
    {
      accessorKey: "simNumber",
      header: "SIM",
      meta: { filterVariant: "text", label: "SIM" },
      cell: ({ row }) => (
        <span className="font-instrument text-muted-foreground">
          {row.original.simNumber}
        </span>
      ),
    },
    {
      accessorKey: "deviceModel",
      header: "โมเดล",
      filterFn: multiSelectFilterFn,
      meta: { filterVariant: "multi-select", label: "โมเดล" },
    },
    {
      id: "hardwareRevisionCode",
      // ไม่มีรุ่นย่อยแสดงว่าง ไม่ใส่ป้ายอะไร (ช่องว่าง = ไม่มีรุ่นย่อย)
      accessorFn: (row) => row.hardwareRevisionCode ?? "",
      header: "รุ่นย่อย",
      meta: { filterVariant: "text", label: "รุ่นย่อย" },
      cell: ({ row }) =>
        row.original.hardwareRevisionCode ? (
          <StatusPill tone="neutral">
            {row.original.hardwareRevisionCode}
          </StatusPill>
        ) : null,
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
        <StatusPill tone={DEVICE_STATUS_TONE[row.original.status] ?? "neutral"}>
          {statusLabel(row.original.status)}
        </StatusPill>
      ),
    },
    {
      id: "customer",
      // ไม่ระบุลูกค้า = "ไม่ระบุ" ตรงๆ ในค่าที่กรอง เพื่อให้เลือกดูเฉพาะเครื่อง
      // ที่ยังไม่ผูกลูกค้าได้ผ่าน dropdown filter เดียวกัน (docs/12 เฟส B)
      accessorFn: (row) => row.customer?.companyName ?? "ไม่ระบุ",
      header: "ลูกค้า",
      filterFn: multiSelectFilterFn,
      meta: { filterVariant: "multi-select", label: "ลูกค้า" },
      cell: ({ row }) =>
        row.original.customer ? (
          row.original.customer.companyName
        ) : (
          <span className="text-muted-foreground">ไม่ระบุ</span>
        ),
    },
    {
      id: "connection",
      accessorFn: (row) => connectionLabel(centralById.get(row.deviceId)),
      header: "การเชื่อมต่อ",
      filterFn: multiSelectFilterFn,
      meta: { filterVariant: "multi-select", label: "การเชื่อมต่อ" },
      cell: ({ row }) => (
        <ConnectionBadge central={centralById.get(row.original.deviceId)} />
      ),
    },
    {
      id: "lastSeen",
      // เรียงตามเวลาจริง (ไม่ใช่ข้อความสัมพัทธ์) · ไม่มีข้อมูล = 0 ไปท้ายตอนเรียงใหม่→เก่า
      accessorFn: (row) => {
        const iso = centralById.get(row.deviceId)?.lastSeenAt;
        return iso ? new Date(iso).getTime() : 0;
      },
      header: "เห็นล่าสุด",
      enableColumnFilter: false,
      meta: { label: "เห็นล่าสุด" },
      cell: ({ row }) => (
        <RelativeTime
          iso={centralById.get(row.original.deviceId)?.lastSeenAt}
          className="text-muted-foreground"
        />
      ),
    },
    {
      id: "firmware",
      accessorFn: (row) =>
        centralById.get(row.deviceId)?.reportedFirmwareVersion ?? "",
      header: "Firmware",
      enableColumnFilter: false,
      meta: { label: "Firmware" },
      cell: ({ row }) => (
        <FirmwareCell
          central={centralById.get(row.original.deviceId)}
          latest={latestFirmware.get(row.original.deviceModel)}
        />
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">การกระทำ</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <span
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <CopyButton value={row.original.deviceId} label="คัดลอก Device ID" />
          <Link
            href={`/devices/${encodeURIComponent(row.original.deviceId)}?tab=history`}
            aria-label={`ประวัติของ ${row.original.deviceId}`}
            title="ประวัติ"
            className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
          >
            <HistoryIcon />
          </Link>
        </span>
      ),
    },
  ];
}

/** ค่าของ `?connection=` ที่หน้านี้รองรับ → ค่าในคอลัมน์ "การเชื่อมต่อ"
 *  (ใช้จากการ์ดบน Dashboard) · ค่าอื่นถูกเมินเงียบๆ */
const CONNECTION_QUERY: Record<string, string> = {
  online: "ออนไลน์",
  offline: "ออฟไลน์",
  unknown: CONNECTION_UNKNOWN,
};

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** ส่งออกเครื่องที่เลือกเป็น CSV ฝั่ง client (ไม่มี endpoint ส่งออก) */
function exportDevicesCsv(
  devices: Device[],
  centralById: Map<string, CentralDevice>,
) {
  const header = ["deviceId", "sim", "model", "protocol", "status", "connection", "firmware"];
  const lines = devices.map((d) => {
    const central = centralById.get(d.deviceId);
    return [
      d.deviceId,
      d.simNumber,
      d.deviceModel,
      d.protocol,
      d.status,
      connectionLabel(central),
      central?.reportedFirmwareVersion ?? "",
    ]
      .map(csvCell)
      .join(",");
  });
  const blob = new Blob([`﻿${[header.join(","), ...lines].join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `devices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DeviceCard({
  device,
  central,
  latest,
}: {
  device: Device;
  central: CentralDevice | undefined;
  latest: Firmware | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-instrument text-sm font-medium">
          {device.deviceId}
        </span>
        <ConnectionBadge central={central} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{device.deviceModel}</span>
        <StatusPill tone={DEVICE_STATUS_TONE[device.status] ?? "neutral"}>
          {statusLabel(device.status)}
        </StatusPill>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <FirmwareCell central={central} latest={latest} />
        <RelativeTime iso={central?.lastSeenAt} className="text-muted-foreground" />
      </div>
    </div>
  );
}

export function DeviceSearchView({
  initialConnection,
}: {
  initialConnection?: string;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const { data, isLoading, error, refetch } = useDevices();
  const devices = useMemo(() => data ?? [], [data]);
  // ข้อมูลเสริมจาก Server กลาง/รายการ Firmware: โหลดไม่ได้ก็แค่ไม่มีข้อมูลเสริม ตารางหลักไม่กระทบ
  const { data: central } = useCentralDevices();
  const { data: firmware } = useFirmwareList(canReadFirmware(session?.role));
  const centralById = useMemo(
    () => onlineByDeviceId(central?.devices ?? []),
    [central],
  );
  const latestFirmware = useMemo(
    () => latestApprovedByModel(firmware ?? []),
    [firmware],
  );
  const columns = useMemo(
    () => buildColumns(centralById, latestFirmware),
    [centralById, latestFirmware],
  );

  // `?connection=` ใช้แค่ตั้งตัวกรองตั้งต้น · ตัดออกจาก URL หลังตารางอ่านไปแล้ว
  // ไม่งั้นล้างตัวกรองแล้วรีเฟรชจะกลับมากรองซ้ำ
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connection")) return;
    params.delete("connection");
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Device Search"
        description="ค้นหาอุปกรณ์ด้วย Device ID หรือเบอร์ SIM แล้วกรองตามโมเดล โปรโตคอล หรือสถานะ คลิกแถวเพื่อดูรายละเอียด"
        actions={
          canRegisterDevice(session?.role) && (
            <Link href="/devices/new" className={buttonVariants()}>
              <PlusIcon />
              ลงทะเบียนอุปกรณ์
            </Link>
          )
        }
      />

      <Card>
        <CardContent>
          {isLoading && data === null ? (
            <TableSkeleton columns={columns.length} />
          ) : error && data === null ? (
            <ErrorState message={error} onRetry={() => void refetch()} />
          ) : devices.length === 0 ? (
            <EmptyState
              icon={BoxIcon}
              message="ยังไม่มีอุปกรณ์ในระบบ"
              action={
                canRegisterDevice(session?.role) ? (
                  <Link
                    href="/devices/new"
                    className={buttonVariants({ size: "sm" })}
                  >
                    <PlusIcon />
                    ลงทะเบียนอุปกรณ์
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              columns={columns}
              data={devices}
              urlSync
              savedViewsKey="devices"
              columnToggle
              initialColumnVisibility={{
                hardwareRevisionCode: false,
                protocol: false,
                customer: false,
              }}
              initialColumnFilters={
                initialConnection && CONNECTION_QUERY[initialConnection]
                  ? [
                      {
                        id: "connection",
                        value: [CONNECTION_QUERY[initialConnection]],
                      },
                    ]
                  : []
              }
              searchPlaceholder="ค้นหา Device ID / SIM…"
              emptyMessage="ไม่พบอุปกรณ์ที่ตรงกับเงื่อนไข ลองล้างตัวกรองบางตัว"
              onRowClick={(device) =>
                router.push(`/devices/${encodeURIComponent(device.deviceId)}`)
              }
              selectable={{
                getRowId: (d) => d.deviceId,
                bulkActions: (selected) => (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(selected.map((d) => d.deviceId).join("\n"))
                          .then(
                            () => toast.success(`คัดลอก ${selected.length} Device ID แล้ว`),
                            () => toast.error("คัดลอกไม่ได้ ใช้ส่งออก CSV แทน"),
                          );
                      }}
                    >
                      คัดลอก Device ID
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => exportDevicesCsv(selected, centralById)}
                    >
                      <DownloadIcon />
                      ส่งออก CSV
                    </Button>
                  </>
                ),
              }}
              renderCard={(device) => (
                <DeviceCard
                  device={device}
                  central={centralById.get(device.deviceId)}
                  latest={latestFirmware.get(device.deviceModel)}
                />
              )}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
