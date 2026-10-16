"use client";


import { RoleGuard } from "@/components/auth/role-guard";
import { canCreateCampaign } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { CampaignCreateForm } from "./campaign-create-form";

/**
 * หน้าสร้างกลุ่มอุปกรณ์ (route เต็ม `/campaigns/new`) — gate ทั้งหน้าด้วย
 * RoleGuard (Operation เท่านั้น ตาม RBAC_Matrix.md §2 แถว "Campaign Wizard")
 * — แก้ไข 2026-09-24 (Campaign Monitor #22): เดิมชื่อ `CampaignWizardView`
 * เพราะเป็น wizard 4 ขั้น ตอนนี้สร้างกลุ่มเปล่าๆ ขั้นตอนเดียว (เปลี่ยนชื่อให้
 * ตรงกับรูปแบบปัจจุบัน)
 */
export function CampaignCreateView({
  sourceIncidentId,
}: {
  sourceIncidentId?: string;
}) {
  return (
    <RoleGuard allow={canCreateCampaign}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="สร้างกลุ่มอุปกรณ์ใหม่"
          description="ตั้งชื่อกลุ่มและเลือกเครื่องที่จะติดตามด้วยกัน หลังสร้างแล้วเริ่มปล่อย Config หรือ Firmware เป็นรอบได้จากหน้ากลุ่ม"
          breadcrumb={[{ label: "สร้างกลุ่มอุปกรณ์ใหม่" }]}
        />

        <CampaignCreateForm sourceIncidentId={sourceIncidentId} />
      </div>
    </RoleGuard>
  );
}
