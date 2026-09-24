"use client";

import Link from "next/link";

import { formatDateTime } from "@/lib/format-date";
import type { PendingCampaignRolloutApproval } from "@/hooks/use-pending-campaign-rollouts";
import type { CampaignRollout } from "@/lib/campaign-api";
import { CampaignRolloutApprovalPanel } from "../campaigns/campaign-rollout-approval-panel";

/**
 * การ์ด 1 รายการ Campaign Rollout ในคิว Approval Center (แก้ไข 2026-09-24 —
 * feedback: หาปุ่มอนุมัติ Rollout ยาก ต้องคลิก 3 ชั้นกว่าจะเจอ) — reuse
 * `CampaignRolloutApprovalPanel` เดิมทั้งดุ้น (มี Separation of Duty check
 * ในตัวอยู่แล้ว) ไม่ต้องเขียนปุ่มอนุมัติ/ปฏิเสธซ้ำ
 */
export function CampaignRolloutApprovalCard({
  item,
  onDecided,
}: {
  item: PendingCampaignRolloutApproval;
  onDecided: (updated: CampaignRollout) => void;
}) {
  const { rollout, campaignName } = item;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{campaignName}</span>
            <span className="text-xs text-muted-foreground">
              {rollout.payloadType} · {rollout.targetCount} เครื่อง
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            เข้าคิว {formatDateTime(rollout.createdAt)}
          </p>
        </div>
        <Link
          href={`/campaigns/${rollout.campaignId}/rollouts/${rollout.id}`}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          ดูรายละเอียด →
        </Link>
      </div>

      <CampaignRolloutApprovalPanel
        campaignId={rollout.campaignId}
        rollout={rollout}
        onDecided={onDecided}
      />
    </div>
  );
}
