"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEVICE_STATUS_TONE, pillClass } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { useDevice } from "@/hooks/use-device";
import { type Device } from "@/lib/device-api";

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right break-words">{children}</span>
    </div>
  );
}

export function DeviceDetailView({ deviceId }: { deviceId: string }) {
  const { data, isLoading, notFound, error, refetch } = useDevice(deviceId);

  if (isLoading && !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลดข้อมูลอุปกรณ์…
      </p>
    );
  }

  if (notFound || error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">
          {notFound ? `ไม่พบอุปกรณ์ ${deviceId}` : error}
        </p>
        <div className="flex gap-2">
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          )}
          <Link
            href="/devices"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปรายการ
          </Link>
        </div>
      </div>
    );
  }

  return <DeviceDetailContent device={data} />;
}

function DeviceDetailContent({ device }: { device: Device }) {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/devices"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Device Search
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">
            {device.deviceId}
          </h1>
          <span
            className={pillClass(
              DEVICE_STATUS_TONE[device.status] ?? "neutral",
            )}
          >
            {device.status}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          ทุก Role เข้าถึงได้ (Read-only)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลอุปกรณ์</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <InfoRow label="SIM Number">
              <span className="font-mono">{device.simNumber}</span>
            </InfoRow>
            <InfoRow label="รุ่น / โปรโตคอล">
              {device.deviceModel} / {device.protocol}
            </InfoRow>
            <InfoRow label="สถานะ">{device.status}</InfoRow>
            <InfoRow label="ลงทะเบียนเมื่อ">
              {formatDateTime(device.registeredAt)}
            </InfoRow>
            <InfoRow label="ติดตั้งเมื่อ">
              {device.installedAt ? formatDateTime(device.installedAt) : "—"}
            </InfoRow>
          </dl>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        สถานะ Config / Firmware ของกล่อง (เทียบเวอร์ชันกับ data กลาง)
        ยังไม่รองรับ — รอ endpoint <code>GET /devices/{"{deviceId}"}/status</code>
      </p>
    </div>
  );
}
