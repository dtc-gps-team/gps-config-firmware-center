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
import { FirmwareApprovalPanel } from "../firmware/firmware-approval-panel";
import { ApprovalQueueCard } from "./approval-queue-card";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Approval Center ของ QAEngineer — คิว Firmware ที่รอตรวจคุณภาพ (`approvalStatus =
 * pending_review`) เรียงเก่าสุดก่อน อนุมัติ/ปฏิเสธได้ในการ์ดเลย หรือกดไปหน้า
 * รายละเอียดเพื่อดูผลทดสอบ (Simulation) ก่อนตัดสินใจ
 */
export function FirmwareReviewView() {
  const { data, isLoading, error, refetch } = useFirmwareList();
  const { resolveName } = useUserNames();

  const pending = useMemo(
    () =>
      (data ?? [])
        .filter((f) => f.approvalStatus === "pending_review")
        .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
    [data],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approval Center"
        description="Firmware ที่รอตรวจคุณภาพ ดูผลทดสอบในหน้ารายละเอียดก่อนอนุมัติหรือปฏิเสธ"
        actions={<RefreshControl />}
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : isLoading && data === null ? (
        <CardListSkeleton />
      ) : pending.length === 0 ? (
        <EmptyState
          icon={CpuIcon}
          message="ไม่มี Firmware รอตรวจคุณภาพตอนนี้ เมื่อ Firmware Engineer อัปโหลดเวอร์ชันใหม่ จะขึ้นที่นี่"
        />
      ) : (
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
      )}
    </div>
  );
}
