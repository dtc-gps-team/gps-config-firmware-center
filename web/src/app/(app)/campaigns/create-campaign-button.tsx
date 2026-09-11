"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateCampaign } from "@/lib/permissions";
import { buttonVariants } from "@/components/ui/button";

/**
 * ปุ่ม "+ สร้างแคมเปญ" — Operation เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Campaign Wizard) role อื่นดูได้อย่างเดียว ไม่เห็นปุ่มนี้เลย
 *
 * เป็น UX-level gate เท่านั้น — การบังคับสิทธิ์จริงอยู่ที่ backend
 * PermissionGuard เสมอ · พาไปหน้า wizard `/campaigns/new`
 */
export function CreateCampaignButton() {
  const { session } = useAuth();

  if (!canCreateCampaign(session?.role)) return null;

  return (
    <Link href="/campaigns/new" className={buttonVariants()}>
      + สร้างแคมเปญ
    </Link>
  );
}
