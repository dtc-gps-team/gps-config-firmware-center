"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { ConfigFieldLabel } from "@/components/config/config-field-label";
import { SensitiveValue } from "@/components/sensitive-value";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useDeviceConfigOverride } from "@/hooks/use-device-config-override";
import { useUserNames } from "@/hooks/use-user-names";
import { formatDateTime } from "@/lib/format-date";
import { canDecideDeviceConfigOverride } from "@/lib/permissions";
import { EntityTypeTag, StatusPill, type PillTone } from "@/lib/status-pill";
import { PageHeader } from "@/components/page-header";
import { DeviceConfigOverrideApprovalActions } from "./device-config-override-approval-actions";

/** ป้ายสถานะ/สีของคำขอ Override — ไม่มีตารางกลางของหน้าอื่นให้ reuse (คำขอ
 * ประเภทนี้ไม่เคยแสดง status pill มาก่อน การ์ดคิวเดิมโชว์แค่ pending เท่านั้น) */
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

function fieldValueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * หน้ารายละเอียดคำขอ Config Override 1 รายการ (แก้ครั้งที่ 94) — เดิมการ์ด
 * ในคิว Approval Center แสดงพารามิเตอร์ไว้ในกล่องเลื่อนเล็กๆ ไม่มีหน้าแยก
 * (สังเกตจาก A 26 ต.ค.) หน้านี้แสดงค่าทั้งหมดแบบไม่ตัดทอน + ประวัติการ
 * ตัดสินใจ ใช้ได้กับทุกสถานะ ไม่ใช่แค่ตอนรออนุมัติ
 */
export function DeviceConfigOverrideDetailView({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useDeviceConfigOverride(id);

  if (isLoading && !data) return <DetailSkeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">
          {error ?? "ไม่พบคำขอนี้"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href="/approvals"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไป Approval Center
          </Link>
        </div>
      </div>
    );
  }

  return <Content key={data.id} item={data} onDecided={() => void refetch()} />;
}

function Content({
  item,
  onDecided,
}: {
  item: NonNullable<ReturnType<typeof useDeviceConfigOverride>["data"]>;
  onDecided: () => void;
}) {
  const { session } = useAuth();
  const canDecide = canDecideDeviceConfigOverride(session?.role);
  const definitions = useConfigDefinitions();
  const { resolveName } = useUserNames();

  const fieldEntries = useMemo(
    () => Object.entries(item.fields).sort(([a], [b]) => a.localeCompare(b)),
    [item.fields],
  );
  const definitionsReady = !definitions.isLoading;
  const sensitiveFieldNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of definitions.data ?? []) {
      if (d.sensitive) set.add(d.fieldName);
    }
    return set;
  }, [definitions.data]);
  const descriptionByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of definitions.data ?? []) {
      if (d.description) map.set(d.fieldName, d.description);
    }
    return map;
  }, [definitions.data]);
  // ก่อน definitions โหลดเสร็จ treat ทุก field เป็น sensitive ไว้ก่อน — mirror
  // config-approval-detail-view.tsx กัน plaintext หลุดช่วงสั้นๆ
  const isMasked = (fieldName: string) =>
    !definitionsReady || sensitiveFieldNames.has(fieldName);

  const inQueue = item.status === "pending";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={<span className="font-mono">{item.deviceId}</span>}
        breadcrumb={[{ label: item.deviceId }]}
        status={
          <>
            <EntityTypeTag type="Config Override" />
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
            <DeviceConfigOverrideApprovalActions
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

      <Card className="gap-3 p-4">
        <p className="text-sm font-medium">
          ค่าที่ขอแก้{" "}
          <span className="text-muted-foreground">
            ({fieldEntries.length})
          </span>
        </p>
        {fieldEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">ไม่มีพารามิเตอร์</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {fieldEntries.map(([key, value]) => (
              <div
                key={key}
                className="flex flex-wrap items-start justify-between gap-4 px-3 py-2 text-sm"
              >
                <ConfigFieldLabel
                  fieldName={key}
                  description={descriptionByField.get(key)}
                />
                {isMasked(key) ? (
                  <SensitiveValue value={value} />
                ) : (
                  <span className="min-w-0 font-mono break-words">
                    {fieldValueText(value)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
