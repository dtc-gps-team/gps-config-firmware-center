"use client";

import Link from "next/link";
import { CalendarIcon, FileIcon, HardDriveIcon, UserIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { type Firmware } from "@/lib/firmware-api";
import {
  FIRMWARE_APPROVAL_STATUS_TONE,
  FIRMWARE_DEVICE_UPDATE_STATUS_TONE,
  FIRMWARE_UPLOAD_STATUS_TONE,
  pillClass,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { formatFileSize } from "@/lib/format-bytes";
import { useFirmware } from "@/hooks/use-firmware";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { EditCompatibilityForm } from "./edit-compatibility-form";
import { FirmwareApprovalPanel } from "./firmware-approval-panel";
import { FirmwareSimulatePanel } from "./firmware-simulate-panel";

export function FirmwareDetailView({ firmwareId }: { firmwareId: string }) {
  const { data, isLoading, error, refetch } = useFirmware(firmwareId);

  if (isLoading && !data) {
    return <DetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{error ?? "ไม่พบ Firmware นี้"}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href="/firmware"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปรายการ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <FirmwareDetailContent
      key={data.id}
      firmware={data}
      onUpdated={() => void refetch()}
    />
  );
}

function FirmwareDetailContent({
  firmware,
  onUpdated,
}: {
  firmware: Firmware;
  onUpdated: (updated: Firmware) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/firmware"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการ Firmware
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold break-words">
            เวอร์ชัน {firmware.version}
          </h1>
          <StatusPill
            tone={FIRMWARE_UPLOAD_STATUS_TONE[firmware.uploadStatus] ?? "neutral"}
          >
            {statusLabel(firmware.uploadStatus)}
          </StatusPill>
          <StatusPill
            tone={
              FIRMWARE_APPROVAL_STATUS_TONE[firmware.approvalStatus] ??
              "neutral"
            }
          >
            {statusLabel(firmware.approvalStatus)}
          </StatusPill>
        </div>
      </div>

      <FirmwareSimulatePanel firmware={firmware} />
      <FirmwareApprovalPanel firmware={firmware} onDecided={onUpdated} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border bg-card p-4">
            <div className="divide-y">
              <InfoRow label="ไฟล์ต้นฉบับ" icon={FileIcon}>
                <span className="font-mono text-xs">
                  {firmware.originalFilename}
                </span>
              </InfoRow>
              <InfoRow label="ขนาดไฟล์" icon={HardDriveIcon}>
                {formatFileSize(firmware.fileSizeBytes)}
              </InfoRow>
              <InfoRow label="สถานะอัปเดตกล่อง">
                <StatusPill
                  tone={
                    FIRMWARE_DEVICE_UPDATE_STATUS_TONE[
                      firmware.deviceUpdateStatus
                    ] ?? "neutral"
                  }
                >
                  {statusLabel(firmware.deviceUpdateStatus)}
                </StatusPill>
              </InfoRow>
              <InfoRow label="อัปโหลดโดย" icon={UserIcon}>
                <span className="font-mono text-xs">{firmware.uploadedBy}</span>
              </InfoRow>
              <InfoRow label="อัปโหลดเมื่อ" icon={CalendarIcon}>
                {formatDateTime(firmware.uploadedAt)}
              </InfoRow>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            รุ่นอุปกรณ์ที่รองรับ{" "}
            <span className="text-muted-foreground">
              ({firmware.deviceModelCompatibility.length})
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {firmware.deviceModelCompatibility.map((m) => (
              <span key={m} className={pillClass("neutral")}>
                {m}
              </span>
            ))}
          </div>
          <EditCompatibilityForm firmware={firmware} onSaved={onUpdated} />
        </div>
      </div>
    </div>
  );
}
