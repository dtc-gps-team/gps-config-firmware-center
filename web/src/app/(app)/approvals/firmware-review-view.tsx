"use client";

import { useMemo } from "react";
import { CpuIcon } from "lucide-react";

import { CardListSkeleton } from "@/components/skeleton/card-list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RefreshControl } from "@/components/refresh-control";
import { useFirmwareList } from "@/hooks/use-firmware";
import { useUserNames } from "@/hooks/use-user-names";
import type { Firmware } from "@/lib/firmware-api";
import { FirmwareApprovalPanel } from "../firmware/firmware-approval-panel";
import { ApprovalQueueCard } from "./approval-queue-card";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Firmware ที่รอตรวจคุณภาพ (`approvalStatus = pending_review`) เรียงเก่าสุดก่อน */
export function pendingFirmwareReviews(data: Firmware[] | null): Firmware[] {
  return (data ?? [])
    .filter((f) => f.approvalStatus === "pending_review")
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

/**
 * คิว Firmware รอตรวจคุณภาพ ใช้ทั้งหน้าของ QAEngineer และแท็บ "ตรวจคุณภาพ
 * Firmware" ใน Approval Center ของ SuperAdmin อนุมัติ/ปฏิเสธได้ในการ์ดเลย หรือ
 * กดไปหน้ารายละเอียดเพื่อดูผลทดสอบ (Simulation) ก่อนตัดสินใจ
 */
export function FirmwareReviewQueue({
  data,
  isLoading,
  error,
  refetch,
}: {
  data: Firmware[] | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => unknown;
}) {
  const { resolveName } = useUserNames();
  const pending = useMemo(() => pendingFirmwareReviews(data), [data]);

  if (error) {
    return <ErrorState message={error} onRetry={() => void refetch()} />;
  }
  if (isLoading && data === null) return <CardListSkeleton />;
  if (pending.length === 0) {
    return (
      <EmptyState
        icon={CpuIcon}
        message="ไม่มี Firmware รอตรวจคุณภาพตอนนี้ เมื่อ Firmware Engineer อัปโหลดเวอร์ชันใหม่ จะขึ้นที่นี่"
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {pending.map((firmware) => (
        <ApprovalQueueCard
          key={firmware.id}
          tag="Firmware"
          title={`เวอร์ชัน ${firmware.version}`}
          meta={`รองรับ ${firmware.deviceModelCompatibility.join(", ") || "-"} ไฟล์ ${formatSize(firmware.fileSizeBytes)}`}
          queuedAt={firmware.uploadedAt}
          detailHref={`/firmware/${firmware.id}`}
          requesterLabel="ผู้อัปโหลด"
          requesterName={resolveName(firmware.uploadedBy)}
          actions={
            <FirmwareApprovalPanel
              firmware={firmware}
              variant="inline"
              onDecided={() => void refetch()}
            />
          }
        />
      ))}
    </div>
  );
}

/**
 * Approval Center ของ QAEngineer: มีแค่คิว Firmware ที่รอตรวจคุณภาพ เพราะ role นี้
 * อ่าน Config/Campaign ไม่ได้
 */
export function FirmwareReviewView() {
  const firmware = useFirmwareList();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approval Center"
        description="Firmware ที่รอตรวจคุณภาพ ดูผลทดสอบในหน้ารายละเอียดก่อนอนุมัติหรือปฏิเสธ"
        actions={<RefreshControl />}
      />
      <FirmwareReviewQueue {...firmware} />
    </div>
  );
}
