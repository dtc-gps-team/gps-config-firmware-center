"use client";

import type { PendingCampaignRolloutApproval } from "@/hooks/use-pending-campaign-rollouts";
import type { CampaignRollout } from "@/lib/campaign-api";
import { CampaignRolloutApprovalPanel } from "../campaigns/campaign-rollout-approval-panel";
import { ApprovalQueueCard } from "./approval-queue-card";

/**
 * การ์ด 1 รายการ Campaign Rollout ในคิว Approval Center (แก้ไข 2026-09-24 —
 * feedback: หาปุ่มอนุมัติ Rollout ยาก ต้องคลิก 3 ชั้นกว่าจะเจอ) — reuse
 * `CampaignRolloutApprovalPanel` เดิม (มี Separation of Duty check ในตัวอยู่
 * แล้ว) แบบ `inline` ไม่มีกล่องเทา ให้หน้าตาเดียวกับการ์ดประเภทอื่นในคิว
 */
export function CampaignRolloutApprovalCard({
  item,
  creatorName,
  onDecided,
}: {
  item: PendingCampaignRolloutApproval;
  creatorName: string;
  onDecided: (updated: CampaignRollout) => void;
}) {
  const { rollout, campaignName } = item;

  return (
    <ApprovalQueueCard
      tag="Campaign"
      title={campaignName}
      meta={`${rollout.payloadType} จำนวน ${rollout.targetCount} เครื่อง`}
      queuedAt={rollout.createdAt}
      detailHref={`/campaigns/${rollout.campaignId}`}
      requesterLabel="ผู้สร้าง"
      requesterName={creatorName}
      actions={
        <CampaignRolloutApprovalPanel
          campaignId={rollout.campaignId}
          rollout={rollout}
          onDecided={onDecided}
          variant="inline"
        />
      }
    />
  );
}
