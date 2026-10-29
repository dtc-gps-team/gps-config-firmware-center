"use client";

import Link from "next/link";
import {
  CalendarIcon,
  FileIcon,
  FingerprintIcon,
  HardDriveIcon,
  UserIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { ErrorState } from "@/components/error-state";
import {
  FIRMWARE_RELEASE_LABEL,
  firmwareRelease,
} from "@/lib/firmware-compare";
import { type Firmware } from "@/lib/firmware-api";
import {
  FIRMWARE_DEVICE_UPDATE_STATUS_TONE,
  FIRMWARE_UPLOAD_STATUS_TONE,
  pillClass,
  StatusPill,
  statusLabel,
  type PillTone,
} from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { formatFileSize } from "@/lib/format-bytes";
import { useFirmware } from "@/hooks/use-firmware";
import { useUserNames } from "@/hooks/use-user-names";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { PageHeader } from "@/components/page-header";
import { EditCompatibilityForm } from "./edit-compatibility-form";
import { FirmwareApprovalPanel } from "./firmware-approval-panel";
import { FirmwareSimulatePanel } from "./firmware-simulate-panel";

const RELEASE_TONE: Record<ReturnType<typeof firmwareRelease>, PillTone> = {
  ready: "success",
  in_review: "progress",
  rejected: "danger",
  upload_failed: "danger",
  uploading: "progress",
};

export function FirmwareDetailView({ firmwareId }: { firmwareId: string }) {
  const { data, isLoading, error, refetch } = useFirmware(firmwareId);

  if (isLoading && !data) {
    return <DetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-3 py-8">
        <ErrorState
          message={error ?? "ไม่พบ Firmware นี้"}
          onRetry={() => void refetch()}
        />
        <Link
          href="/firmware"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}
        >
          กลับไปรายการ
        </Link>
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
  const { resolveName } = useUserNames();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`เวอร์ชัน ${firmware.version}`}
        breadcrumb={[{ label: `เวอร์ชัน ${firmware.version}` }]}
        status={
          <>
            <StatusPill tone={RELEASE_TONE[firmwareRelease(firmware)]}>
              {FIRMWARE_RELEASE_LABEL[firmwareRelease(firmware)]}
            </StatusPill>
            {firmware.uploadStatus !== "stored" && (
              <StatusPill
                tone={FIRMWARE_UPLOAD_STATUS_TONE[firmware.uploadStatus] ?? "neutral"}
              >
                {statusLabel(firmware.uploadStatus)}
              </StatusPill>
            )}
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <FirmwareApprovalPanel firmware={firmware} onDecided={onUpdated} />
          <FirmwareSimulatePanel firmware={firmware} />

          <Card className="p-4">
            <div className="divide-y">
              <InfoRow label="ไฟล์ต้นฉบับ" icon={FileIcon}>
                <span className="font-instrument text-xs break-all">
                  {firmware.originalFilename}
                </span>
              </InfoRow>
              <InfoRow label="ขนาดไฟล์" icon={HardDriveIcon}>
                {formatFileSize(firmware.fileSizeBytes)}
              </InfoRow>
              <InfoRow label="SHA-256" icon={FingerprintIcon}>
                {firmware.checksumSha256 ? (
                  <span className="inline-flex items-start gap-1">
                    <span className="font-instrument text-xs break-all">
                      {firmware.checksumSha256}
                    </span>
                    <CopyButton value={firmware.checksumSha256} label="คัดลอก SHA-256" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    ไม่มี (อัปโหลดก่อนมีฟีเจอร์นี้)
                  </span>
                )}
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
                {resolveName(firmware.uploadedBy)}
              </InfoRow>
              <InfoRow label="อัปโหลดเมื่อ" icon={CalendarIcon}>
                {formatDateTime(firmware.uploadedAt)}
              </InfoRow>
            </div>
          </Card>
        </div>

        <Card className="gap-3 p-4 lg:sticky lg:top-24">
          <p className="text-sm font-medium">
            โมเดลที่รองรับ{" "}
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
        </Card>
      </div>
    </div>
  );
}
