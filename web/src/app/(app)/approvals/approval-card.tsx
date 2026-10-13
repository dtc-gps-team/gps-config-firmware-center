"use client";

import { useConfigVersions } from "@/hooks/use-config-versions";
import type { PendingApproval } from "@/hooks/use-pending-approvals";
import { diffConfigFields } from "@/lib/config-diff";
import { ApprovalActions } from "./approval-actions";
import { ApprovalQueueCard } from "./approval-queue-card";

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

  return (
    <ApprovalQueueCard
      tag="Config"
      title={item.name}
      meta={`${item.deviceModel} · ${item.protocol}`}
      queuedAt={item.queuedAt}
      detailHref={`/approvals/config/${item.id}`}
      description={item.description}
      requesterLabel="ผู้สร้าง"
      requesterName={creatorName}
      extra={
        item.suggestedApprover && (
          <span className="mt-1 inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            เจาะจงถึง: {item.suggestedApprover.fullName}
          </span>
        )
      }
      summary={
        <span className="text-muted-foreground">
          {changeSummary ?? `${Object.keys(item.fields).length} ค่า`}
        </span>
      }
      actions={
        <ApprovalActions
          configId={item.id}
          configName={item.name}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      }
    />
  );
}
