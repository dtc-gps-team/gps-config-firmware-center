"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateCampaign } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * ปุ่ม "+ สร้างแคมเปญ" — Operation เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Campaign Wizard) role อื่นดูได้อย่างเดียว ไม่เห็นปุ่มนี้เลย
 *
 * ปุ่มเป็น scaffold `disabled` อยู่แล้ว รอต่อ endpoint จริง (ยังไม่มีโมดูล
 * `campaign` ใน spec — ดู RBAC_Matrix.md ตาราง 4.2) component นี้คุมแค่ว่า
 * "ควรเห็นปุ่มนี้ไหม" (UX-level gate เท่านั้น)
 */
export function CreateCampaignButton() {
  const { session } = useAuth();

  if (!canCreateCampaign(session?.role)) return null;

  return <Button disabled>+ สร้างแคมเปญ</Button>;
}
