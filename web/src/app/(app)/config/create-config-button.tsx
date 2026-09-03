"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * ปุ่ม "+ สร้าง Config ใหม่" — SW เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Config Editor) role อื่นไม่เห็นปุ่มนี้เลย (ดู Config ได้อย่างเดียว)
 *
 * ปุ่มเป็น scaffold `disabled` อยู่แล้ว รอต่อ POST /config จริง — component นี้
 * คุมแค่ว่า "ควรเห็นปุ่มนี้ไหม" (UX-level gate เท่านั้น การบังคับสิทธิ์จริงอยู่
 * ที่ backend PermissionGuard เสมอ)
 */
export function CreateConfigButton() {
  const { session } = useAuth();

  if (!canCreateConfig(session?.role)) return null;

  return <Button disabled>+ สร้าง Config ใหม่</Button>;
}
