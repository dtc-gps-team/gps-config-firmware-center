"use client";

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { EntityTypeTag, StalePendingBadge } from "@/lib/status-pill";
import { formatDateTime, stalePendingLabel } from "@/lib/format-date";
import { useConfigVersions } from "@/hooks/use-config-versions";
import type { PendingApproval } from "@/hooks/use-pending-approvals";
import { diffConfigFields } from "@/lib/config-diff";
import { ApprovalActions } from "./approval-actions";

export function ApprovalCard({
  item,
  creatorName,
  canDecide,
  onDecided,
}: {
  item: PendingApproval;
  /** ชื่อผู้สร้างที่ resolve แล้ว (หน้าคิว resolve ครั้งเดียวแล้วส่งลงมา กันยิง
   * GET /users ซ้ำต่อการ์ด) */
  creatorName: string;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
}) {
  const versions = useConfigVersions(item.id);
  const staleLabel = stalePendingLabel(item.queuedAt);
  // เทียบกับเวอร์ชันที่อนุมัติล่าสุดเพื่อบอกจำนวนที่เปลี่ยนบนการ์ด · ยังโหลด
  // ไม่เสร็จหรือโหลดพลาดก็แค่ไม่โชว์ตัวเลข ไม่กระทบปุ่มอนุมัติ
  const latest = (versions.data ?? []).reduce<
    NonNullable<typeof versions.data>[number] | null
  >((best, v) => (best && best.versionNumber >= v.versionNumber ? best : v), null);
  const changeSummary =
    versions.data === null
      ? null
      : latest
        ? `เปลี่ยนจากเวอร์ชัน ${latest.versionNumber} จำนวน ${
            diffConfigFields(latest.fields, item.fields).changes.length
          } ค่า`
        : "ยังไม่เคยอนุมัติ (เวอร์ชันแรก)";

  // โครงเดียวกับ CampaignRolloutApprovalCard: ลิงก์ "ดูรายละเอียด" บนขวา
  // ปุ่มตัดสินใจอยู่ใต้ข้อมูล การ์ดในคิวเดียวกันจะได้หน้าตาไปทางเดียวกัน
  return (
    <Card
      className={
        staleLabel ? "gap-3 border-l-4 border-l-amber-500" : "gap-3"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4 px-4">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <EntityTypeTag type="Config" />
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">
              {item.deviceModel} · {item.protocol}
            </span>
            {staleLabel && <StalePendingBadge label={staleLabel} />}
          </div>
          {item.description && (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            ผู้สร้าง {creatorName} เข้าคิว {formatDateTime(item.queuedAt)}
          </p>
          <p className="text-xs text-muted-foreground">
            {changeSummary ?? `${Object.keys(item.fields).length} ค่า`}
          </p>
          {item.suggestedApprover && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              เจาะจงถึง: {item.suggestedApprover.fullName}
            </span>
          )}
        </div>
        <Link
          href={`/approvals/config/${item.id}`}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          ดูรายละเอียด →
        </Link>
      </div>

      <div className="px-4">
        <ApprovalActions
          configId={item.id}
          configName={item.name}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      </div>
    </Card>
  );
}
