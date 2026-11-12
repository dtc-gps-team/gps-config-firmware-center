"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CalendarIcon,
  FileIcon,
  HardDriveIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/error-state";
import {
  FIRMWARE_RELEASE_LABEL,
  firmwareRelease,
} from "@/lib/firmware-compare";
import { ApiError } from "@/lib/api";
import { deleteFirmware, type Firmware } from "@/lib/firmware-api";
import { canDeleteFirmware } from "@/lib/permissions";
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
  const router = useRouter();
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** คืน false = ไม่ปิด dialog ให้เห็นเหตุผล 409 (เช่น มีกล่องกำลังรันอยู่) */
  async function handleDelete(): Promise<boolean> {
    if (!session?.accessToken) return false;
    setDeleteError(null);
    try {
      await deleteFirmware(session.accessToken, firmware.id);
      toast.success(`ลบ Firmware เวอร์ชัน ${firmware.version} แล้ว`);
      router.push("/firmware");
      router.refresh();
      return true;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "ลบ Firmware ไม่สำเร็จ";
      setDeleteError(message);
      toast.error(message);
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`เวอร์ชัน ${firmware.version}`}
        breadcrumb={[{ label: `เวอร์ชัน ${firmware.version}` }]}
        actions={
          canDeleteFirmware(session?.role) ? (
            <Button
              variant="outline"
              size="icon"
              aria-label="ลบ Firmware นี้"
              title="ลบ Firmware นี้"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setDeleteError(null);
                setConfirming(true);
              }}
            >
              <Trash2Icon />
            </Button>
          ) : undefined
        }
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

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="ลบ Firmware นี้?"
        description={
          <>
            ลบไฟล์ของเวอร์ชัน {firmware.version} ออกจากระบบถาวร กู้คืนไม่ได้
            ต้องอัปโหลดใหม่ถ้าจะใช้อีก และ Rollback กลับมาเวอร์ชันนี้ไม่ได้ ไม่กระทบ
            กล่องที่ไม่ได้รันเวอร์ชันนี้ ถ้ามีกล่องกำลังรันเวอร์ชันนี้อยู่หรือยังมี
            Rollout/คำขอที่ใช้อยู่ จะลบไม่ได้
            {deleteError && (
              <span className="mt-2 block text-destructive">{deleteError}</span>
            )}
          </>
        }
        confirmLabel="ยืนยันลบ"
        destructive
        onConfirm={handleDelete}
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
