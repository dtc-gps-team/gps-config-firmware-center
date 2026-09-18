"use client";

import Link from "next/link";
import {
  Building2Icon,
  CalendarCheckIcon,
  CalendarIcon,
  CardSimIcon,
  RadioIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { DEVICE_STATUS_TONE, StatusPill, statusLabel } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { useDevice } from "@/hooks/use-device";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { type Device } from "@/lib/device-api";

export function DeviceDetailView({ deviceId }: { deviceId: string }) {
  const { data, isLoading, notFound, error, refetch } = useDevice(deviceId);

  if (isLoading && !data) {
    return <DetailSkeleton />;
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
    <div className="flex flex-col gap-6">
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
            {statusLabel(device.status)}
          </StatusPill>
        </div>
        <p className="text-sm text-muted-foreground">
          ทุก Role เข้าถึงได้ (Read-only)
        </p>
      </div>

      {/* เนื้อหาเป็น label/value ล้วนเหมือน Campaign detail — จำกัด max-width
       * ไว้ที่การ์ดนี้ ไม่ปล่อยเต็มความกว้างหน้าจอ (mirror ปัญหาเดียวกับที่
       * แก้ไปแล้วในหน้า detail อื่น) */}
      <div className="max-w-xl rounded-xl border bg-card p-4">
        <div className="divide-y">
          <InfoRow label="SIM Number" icon={CardSimIcon}>
            <span className="font-mono">{device.simNumber}</span>
          </InfoRow>
          <InfoRow label="รุ่นอุปกรณ์" icon={SlidersHorizontalIcon}>
            {device.deviceModel}
          </InfoRow>
          <InfoRow label="โปรโตคอล" icon={RadioIcon}>
            {device.protocol}
          </InfoRow>
          <InfoRow label="ลูกค้า" icon={Building2Icon}>
            {device.customer ? (
              device.customer.companyName
            ) : (
              <span className="text-muted-foreground">ไม่ระบุ</span>
            )}
          </InfoRow>
          <InfoRow label="ลงทะเบียนเมื่อ" icon={CalendarIcon}>
            {formatDateTime(device.registeredAt)}
          </InfoRow>
          <InfoRow label="ติดตั้งเมื่อ" icon={CalendarCheckIcon}>
            {device.installedAt ? formatDateTime(device.installedAt) : "—"}
          </InfoRow>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        สถานะ Config / Firmware ของกล่อง (เทียบเวอร์ชันกับ data กลาง)
        ยังไม่รองรับ — รอ endpoint <code>GET /devices/{"{deviceId}"}/status</code>
      </p>
    </div>
  );
}
