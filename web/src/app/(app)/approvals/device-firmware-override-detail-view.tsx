"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { useDeviceFirmwareOverride } from "@/hooks/use-device-firmware-override";
import { useFirmware } from "@/hooks/use-firmware";
import { useUserNames } from "@/hooks/use-user-names";
import { formatDateTime } from "@/lib/format-date";
import { canDecideFirmwareOverride } from "@/lib/permissions";
import { EntityTypeTag, StatusPill, type PillTone } from "@/lib/status-pill";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { DeviceFirmwareOverrideApprovalActions } from "./device-firmware-override-approval-actions";

/** mirror device-config-override-detail-view.tsx ทุกประการ — ไม่ใช้ร่วมกัน
 * เพราะ Firmware ไม่มี `fields`/`rejectReason` masking ให้ต่าง */
const OVERRIDE_STATUS_LABEL: Record<string, string> = {
  pending: "รอการอนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ถูกปฏิเสธ",
};
const OVERRIDE_STATUS_TONE: Record<string, PillTone> = {
  pending: "progress",
  approved: "success",
  rejected: "danger",
};

/**
 * หน้ารายละเอียดคำขอ Firmware Override รายเครื่อง 1 รายการ (แก้ครั้งที่ 94)
 * — mirror DeviceConfigOverrideDetailView ต่างกันที่ไม่มี `fields` (Firmware
 * เป็นเวอร์ชันเดียวทั้งก้อน) แต่เพิ่มสถานะ "ใช้ไปแล้ว" (`consumedAt`,
 * single-use ตอน confirmFirmwareInstall)
 */
export function DeviceFirmwareOverrideDetailView({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useDeviceFirmwareOverride(id);

  if (isLoading && !data) return <DetailSkeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col gap-3 py-8">
        <ErrorState message={error ?? "ไม่พบคำขอนี้"} onRetry={() => void refetch()} />
        <Link
          href="/approvals"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}
        >
          กลับไป Approval Center
        </Link>
      </div>
    );
  }

  return <Content key={data.id} item={data} onDecided={() => void refetch()} />;
}

function Content({
  item,
  onDecided,
}: {
  item: NonNullable<ReturnType<typeof useDeviceFirmwareOverride>["data"]>;
  onDecided: () => void;
}) {
  const { session } = useAuth();
  const canDecide = canDecideFirmwareOverride(session?.role);
  const { resolveName } = useUserNames();
  const firmwareQuery = useFirmware(item.firmwareId);

  const inQueue = item.status === "pending";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={<span className="font-instrument">{item.deviceId}</span>}
        breadcrumb={[{ label: item.deviceId }]}
        status={
          <>
            <EntityTypeTag type="Firmware Override" />
            <StatusPill tone={OVERRIDE_STATUS_TONE[item.status] ?? "neutral"}>
              {OVERRIDE_STATUS_LABEL[item.status] ?? item.status}
            </StatusPill>
          </>
        }
        description={item.reason}
        meta={
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">เวอร์ชัน</dt>
              <dd>#{item.versionNumber}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Firmware ที่ขอ</dt>
              <dd className="font-instrument">
                {firmwareQuery.data
                  ? `v${firmwareQuery.data.version}`
                  : item.firmwareId}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">ผู้ส่งคำขอ</dt>
              <dd>{resolveName(item.overriddenBy)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">ส่งเมื่อ</dt>
              <dd>{formatDateTime(item.overriddenAt)}</dd>
            </div>
            {item.decidedBy && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">
                  {item.status === "rejected" ? "ปฏิเสธโดย" : "อนุมัติโดย"}
                </dt>
                <dd>{resolveName(item.decidedBy)}</dd>
              </div>
            )}
            {item.decidedAt && (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">ตัดสินใจเมื่อ</dt>
                <dd>{formatDateTime(item.decidedAt)}</dd>
              </div>
            )}
          </dl>
        }
        actions={
          inQueue && (
            <DeviceFirmwareOverrideApprovalActions
              id={item.id}
              deviceId={item.deviceId}
              canDecide={canDecide}
              onDecided={onDecided}
            />
          )
        }
      />

      {!inQueue && (
        <Notice tone="warning">
          คำขอนี้ไม่อยู่ในคิวรออนุมัติแล้ว (สถานะ{" "}
          {OVERRIDE_STATUS_LABEL[item.status] ?? item.status})
        </Notice>
      )}

      {item.status === "rejected" && item.rejectReason && (
        <Notice tone="danger">เหตุผลที่ปฏิเสธ: {item.rejectReason}</Notice>
      )}

      {item.status === "approved" && (
        <Card className="gap-2 p-4">
          <p className="text-sm font-medium">การใช้สิทธิ์ (single-use)</p>
          <p className="text-sm text-muted-foreground">
            {item.consumedAt
              ? `ใช้ไปแล้วตอน ${formatDateTime(item.consumedAt)} (ช่างยืนยันติดตั้งไปแล้ว) — ติดตั้งซ้ำอีกครั้งต้องขอ override ใหม่`
              : "ยังไม่เคยถูกใช้ — รอช่างกดยืนยันติดตั้ง Firmware เวอร์ชันนี้ผ่านแอป"}
          </p>
        </Card>
      )}
    </div>
  );
}
