"use client";

import Link from "next/link";

import { RoleGuard } from "@/components/auth/role-guard";
import { canCreateCampaign } from "@/lib/permissions";
import { CampaignCreateForm } from "./campaign-create-form";

/**
 * หน้าสร้างกลุ่มอุปกรณ์ (route เต็ม `/campaigns/new`) — gate ทั้งหน้าด้วย
 * RoleGuard (Operation เท่านั้น ตาม RBAC_Matrix.md §2 แถว "Campaign Wizard")
 * — แก้ไข 2026-09-24 (Campaign Monitor #22): เดิมชื่อ `CampaignWizardView`
 * เพราะเป็น wizard 4 ขั้น ตอนนี้สร้างกลุ่มเปล่าๆ ขั้นตอนเดียว (เปลี่ยนชื่อให้
 * ตรงกับรูปแบบปัจจุบัน)
 */
export function CampaignCreateView() {
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
          <h1 className="text-2xl font-semibold">สร้างกลุ่มอุปกรณ์ใหม่</h1>
        </div>

        <CampaignCreateForm />
      </div>
    </RoleGuard>
  );
}
