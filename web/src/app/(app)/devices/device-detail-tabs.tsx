"use client";

import Link from "next/link";
import {
  ActivityIcon,
  ClockIcon,
  CpuIcon,
  FileCogIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  SendIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommandStatusSteps } from "@/components/command-status-steps";
import { EmptyState } from "@/components/empty-state";
import { InfoRow } from "@/components/info-row";
import { RelativeTime } from "@/components/relative-time";
import { useDeviceCentral } from "@/hooks/use-central-devices";
import { useDeviceStatus } from "@/hooks/use-device-status";
import type { CentralLastCommand } from "@/lib/central-device-api";
import {
  centralCommandActionLabel,
  centralCommandStatusLabel,
  centralCommandStatusTone,
} from "@/lib/central-device-display";
import {
  DEVICE_PAYLOAD_STATUS_TONE,
  devicePayloadStatusLabel,
} from "@/lib/device-payload-status";
import type { Device } from "@/lib/device-api";
import type { Firmware } from "@/lib/firmware-api";
import { isFirmwareOutdated } from "@/lib/firmware-staleness";
import { formatDateTime } from "@/lib/format-date";
import { StatusPill } from "@/lib/status-pill";

type CentralState = ReturnType<typeof useDeviceCentral>;

/** คำสั่งล่าสุดไปกล่อง: รอส่ง → ส่งแล้ว → กล่องตอบรับ → … → ล้มเหลว ตามที่ Server กลางรายงาน */
function CommandRow({ cmd }: { cmd: CentralLastCommand | null | undefined }) {
  if (!cmd) {
    return <span className="text-muted-foreground">ยังไม่เคยสั่ง</span>;
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <span>
        {centralCommandActionLabel(cmd.action)}
        {cmd.target ? ` ถึงเวอร์ชัน ${cmd.target}` : ""}
      </span>
      <StatusPill tone={centralCommandStatusTone(cmd.status)}>
        {centralCommandStatusLabel(cmd.status)}
      </StatusPill>
      <CommandStatusSteps status={cmd.status} />
      {cmd.errorCode && (
        <span className="font-instrument text-xs text-muted-foreground">
          {cmd.errorCode}
        </span>
      )}
      {cmd.updatedAt && (
        <RelativeTime iso={cmd.updatedAt} className="text-xs text-muted-foreground" />
      )}
    </div>
  );
}

export function DeviceConfigTab({
  deviceId,
  central,
}: {
  deviceId: string;
  central: CentralState;
}) {
  const status = useDeviceStatus(deviceId);
  const c = central.data?.device ?? null;
  const behind =
    c !== null &&
    c.desiredConfigVersion !== null &&
    c.reportedConfigVersion !== c.desiredConfigVersion;
  const cmd = c?.lastCommand?.action === "UPDATE_CONFIG" ? c.lastCommand : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Config ของเครื่องนี้</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="divide-y">
          <InfoRow label="สถานะตาม Rollout ล่าสุด" icon={FileCogIcon}>
            {status.data ? (
              <StatusPill
                tone={DEVICE_PAYLOAD_STATUS_TONE[status.data.configStatus] ?? "neutral"}
              >
                {devicePayloadStatusLabel("config", status.data.configStatus)}
              </StatusPill>
            ) : (
              <span className="text-muted-foreground">
                {status.isLoading ? "กำลังโหลด" : "-"}
              </span>
            )}
          </InfoRow>
          <InfoRow label="Config ที่กล่องรายงาน" icon={ActivityIcon}>
            <span className="font-instrument">
              {c?.reportedConfigVersion != null ? `v${c.reportedConfigVersion}` : "ยังไม่รายงาน"}
            </span>
          </InfoRow>
          <InfoRow label="Config เป้าหมาย" icon={FileCogIcon}>
            <span className="inline-flex items-center gap-2">
              <span className="font-instrument">
                {c?.desiredConfigVersion != null ? `v${c.desiredConfigVersion}` : "-"}
              </span>
              {behind && (
                <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-xs font-medium text-warning-foreground">
                  ยังไม่ตรงเป้าหมาย
                </span>
              )}
            </span>
          </InfoRow>
          <InfoRow label="คำสั่ง Config ล่าสุด" icon={SendIcon}>
            <CommandRow cmd={cmd} />
          </InfoRow>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/config" className={buttonVariants({ variant: "outline", size: "sm" })}>
            ไปหน้า Config
          </Link>
          <Link href="/approvals" className={buttonVariants({ variant: "outline", size: "sm" })}>
            คำขอแก้ค่าเฉพาะเครื่องที่รออนุมัติ
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function DeviceFirmwareTab({
  deviceId,
  central,
  latestFirmware,
}: {
  deviceId: string;
  central: CentralState;
  latestFirmware: Firmware | undefined;
}) {
  const status = useDeviceStatus(deviceId);
  const c = central.data?.device ?? null;
  const version = c?.reportedFirmwareVersion ?? null;
  const outdated = isFirmwareOutdated(version, latestFirmware);
  const cmd = c?.lastCommand?.action === "UPDATE_FIRMWARE" ? c.lastCommand : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Firmware ของเครื่องนี้</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="divide-y">
          <InfoRow label="เวอร์ชันที่กล่องรายงาน" icon={CpuIcon}>
            {version ? (
              <span className="font-instrument">{version}</span>
            ) : (
              <span className="text-muted-foreground">ยังไม่รายงาน</span>
            )}
          </InfoRow>
          <InfoRow label="ล่าสุดที่อนุมัติสำหรับโมเดลนี้" icon={CpuIcon}>
            {latestFirmware ? (
              <span className="inline-flex items-center gap-2">
                <span className="font-instrument">{latestFirmware.version}</span>
                {outdated && (
                  <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-xs font-medium text-warning-foreground">
                    เครื่องนี้ล้าสมัย
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">ยังไม่มี Firmware ที่อนุมัติ</span>
            )}
          </InfoRow>
          <InfoRow label="สถานะตาม Rollout ล่าสุด" icon={ActivityIcon}>
            {status.data ? (
              <StatusPill
                tone={DEVICE_PAYLOAD_STATUS_TONE[status.data.firmwareStatus] ?? "neutral"}
              >
                {devicePayloadStatusLabel("firmware", status.data.firmwareStatus)}
              </StatusPill>
            ) : (
              <span className="text-muted-foreground">
                {status.isLoading ? "กำลังโหลด" : "-"}
              </span>
            )}
          </InfoRow>
          <InfoRow label="คำสั่ง Firmware ล่าสุด" icon={SendIcon}>
            <CommandRow cmd={cmd} />
          </InfoRow>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/firmware" className={buttonVariants({ variant: "outline", size: "sm" })}>
            ไปหน้า Firmware
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function DeviceTelemetryTab({ central }: { central: CentralState }) {
  const lastSeen = central.data?.device?.lastSeenAt ?? null;
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={RadioTowerIcon}
          message="ระบบยังไม่รับค่า Telemetry จากกล่อง (พิกัด แรงดัน สัญญาณ) จึงยังไม่มีกราฟให้แสดง"
          action={
            lastSeen ? (
              <p className="text-xs text-muted-foreground">
                สัญญาณล่าสุดจากกล่อง{" "}
                <span data-tabular>{formatDateTime(lastSeen)}</span>
              </p>
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

export function DeviceLogsTab({
  central,
  device,
}: {
  central: CentralState;
  device: Device;
}) {
  const cmd = central.data?.device?.lastCommand ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>คำสั่งที่ส่งถึง {device.deviceId}</CardTitle>
      </CardHeader>
      <CardContent>
        {cmd ? (
          <div className="divide-y">
            <InfoRow label="คำสั่งล่าสุดจาก Server กลาง" icon={ScrollTextIcon}>
              <CommandRow cmd={cmd} />
            </InfoRow>
            {cmd.updatedAt && (
              <InfoRow label="อัปเดตสถานะเมื่อ" icon={ClockIcon}>
                {formatDateTime(cmd.updatedAt)}
              </InfoRow>
            )}
          </div>
        ) : (
          <EmptyState
            icon={ScrollTextIcon}
            message="ยังไม่มีบันทึกคำสั่งของเครื่องนี้ Server กลางเก็บเฉพาะคำสั่งล่าสุด"
          />
        )}
      </CardContent>
    </Card>
  );
}
