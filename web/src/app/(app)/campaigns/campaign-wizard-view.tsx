"use client";

import Link from "next/link";

import { RoleGuard } from "@/components/auth/role-guard";
import { canCreateCampaign } from "@/lib/permissions";
import { CampaignWizard } from "./campaign-wizard";

/**
 * หน้า wizard สร้างแคมเปญ (route เต็ม `/campaigns/new`) — gate ทั้งหน้าด้วย
 * RoleGuard (Operation เท่านั้น ตาม RBAC_Matrix.md §2 แถว "Campaign Wizard")
 */
export function CampaignWizardView() {
  return (
    <RoleGuard allow={canCreateCampaign}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/campaigns"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← กลับไปรายการแคมเปญ
          </Link>
          <h1 className="text-2xl font-semibold">สร้างแคมเปญใหม่</h1>
        </div>

        <CampaignWizard />
      </div>
    </RoleGuard>
  );
}
