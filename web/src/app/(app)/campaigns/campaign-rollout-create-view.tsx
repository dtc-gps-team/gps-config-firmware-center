"use client";

import Link from "next/link";

import { RoleGuard } from "@/components/auth/role-guard";
import { canCreateCampaign } from "@/lib/permissions";
import { CampaignRolloutCreateForm } from "./campaign-rollout-create-form";

/**
 * หน้าเริ่ม Rollout ใหม่ (route เต็ม `/campaigns/{id}/rollouts/new`) — gate
 * ทั้งหน้าด้วย RoleGuard (Operation เท่านั้น ตาม RBAC_Matrix.md §2 แถว
 * "Campaign Wizard" — resource `campaign` เดียวกับสร้างกลุ่ม) Campaign
 * Monitor #22, แก้ไข 2026-09-24
 */
export function CampaignRolloutCreateView({
  campaignId,
}: {
  campaignId: string;
}) {
  return (
    <RoleGuard allow={canCreateCampaign}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href={`/campaigns/${campaignId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับไปหน้ากลุ่ม
          </Link>
          <h1 className="text-2xl font-semibold">เริ่ม Rollout ใหม่</h1>
        </div>

        <CampaignRolloutCreateForm campaignId={campaignId} />
      </div>
    </RoleGuard>
  );
}
