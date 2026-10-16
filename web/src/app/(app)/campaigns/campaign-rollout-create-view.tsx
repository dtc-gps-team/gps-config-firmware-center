"use client";


import { RoleGuard } from "@/components/auth/role-guard";
import { canCreateCampaign } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
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
        <PageHeader
          title="เริ่ม Rollout ใหม่"
          description="เลือกเครื่องในกลุ่ม และ Config หรือ Firmware ที่จะปล่อย รอบนี้ต้องให้ Operation อีกคนอนุมัติก่อนปล่อยจริง"
          breadcrumb={[
            { label: "กลุ่มอุปกรณ์", href: `/campaigns/${campaignId}` },
            { label: "เริ่ม Rollout ใหม่" },
          ]}
        />

        <CampaignRolloutCreateForm campaignId={campaignId} />
      </div>
    </RoleGuard>
  );
}
