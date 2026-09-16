"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEVICE_STATUS_TONE, StatusPill } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { useDevice } from "@/hooks/use-device";
import { type Device } from "@/lib/device-api";

function InfoItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm break-words">{children}</span>
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
          <StatusPill tone={DEVICE_STATUS_TONE[device.status] ?? "neutral"}>
            {device.status}
          </StatusPill>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoItem label="SIM Number">
              <span className="font-mono">{device.simNumber}</span>
            </InfoItem>
            <InfoItem label="รุ่น / โปรโตคอล">
              {device.deviceModel} / {device.protocol}
            </InfoItem>
            <InfoItem label="ลูกค้า">
              {device.customer ? (
                device.customer.companyName
              ) : (
                <span className="text-muted-foreground">ไม่ระบุ</span>
              )}
            </InfoItem>
            <InfoItem label="ลงทะเบียนเมื่อ">
              {formatDateTime(device.registeredAt)}
            </InfoItem>
            <InfoItem label="ติดตั้งเมื่อ">
              {device.installedAt ? formatDateTime(device.installedAt) : "—"}
            </InfoItem>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        สถานะ Config / Firmware ของกล่อง (เทียบเวอร์ชันกับ data กลาง)
        ยังไม่รองรับ — รอ endpoint <code>GET /devices/{"{deviceId}"}/status</code>
      </p>
    </div>
  );
}
