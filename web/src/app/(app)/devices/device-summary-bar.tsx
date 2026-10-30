"use client";

import { TriangleAlertIcon } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { useDeviceCentral } from "@/hooks/use-central-devices";
import type { Device } from "@/lib/device-api";
import type { Firmware } from "@/lib/firmware-api";
import { isFirmwareOutdated } from "@/lib/firmware-staleness";
import { DEVICE_STATUS_TONE, StatusPill, statusLabel } from "@/lib/status-pill";

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="label-caps text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm">{children}</span>
    </div>
  );
}

/**
 * แถบสรุปเครื่องที่ติดอยู่ใต้ top bar ตอนเลื่อน (ทุกแท็บเห็นเสมอ): Device ID,
 * การเชื่อมต่อ, เห็นล่าสุด, Firmware (เตือนเมื่อล้าสมัย), โมเดล, สถานะวงจรชีวิต
 */
export function DeviceSummaryBar({
  device,
  central,
  latestFirmware,
}: {
  device: Device;
  central: ReturnType<typeof useDeviceCentral>;
  latestFirmware: Firmware | undefined;
}) {
  const c = central.data?.device ?? null;
  const reachable = central.data?.reachable ?? false;
  const version = c?.reportedFirmwareVersion ?? null;
  const outdated = isFirmwareOutdated(version, latestFirmware);

  return (
    <div
      data-testid="device-summary-bar"
      className="sticky top-16 z-(--z-sticky) -mx-4 border-b bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Item label="Device ID">
          <span className="font-instrument font-medium">{device.deviceId}</span>
          <CopyButton value={device.deviceId} label="คัดลอก Device ID" />
        </Item>
        <Item label="การเชื่อมต่อ">
          {!reachable || !c ? (
            <span className="text-muted-foreground">ไม่ทราบ</span>
          ) : (
            <StatusBadge tone={c.online ? "online" : "offline"} pulse={c.online}>
              {c.online ? "ออนไลน์" : "ออฟไลน์"}
            </StatusBadge>
          )}
        </Item>
        <Item label="เห็นล่าสุด">
          <RelativeTime iso={c?.lastSeenAt} className="text-muted-foreground" />
        </Item>
        <Item label="Firmware">
          {version ? (
            <>
              <span className="font-instrument">{version}</span>
              {outdated && latestFirmware && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-1.5 py-0.5 text-xs font-medium text-warning-foreground"
                  title={`ล่าสุดที่อนุมัติ ${latestFirmware.version}`}
                >
                  <TriangleAlertIcon className="size-3" />
                  ล้าสมัย
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </Item>
        <Item label="โมเดล">{device.deviceModel}</Item>
        <Item label="สถานะ">
          <StatusPill tone={DEVICE_STATUS_TONE[device.status] ?? "neutral"}>
            {statusLabel(device.status)}
          </StatusPill>
        </Item>
      </div>
    </div>
  );
}
