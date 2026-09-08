"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * ปุ่ม "+ สร้าง Config ใหม่" — SW เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Config Editor) role อื่นไม่เห็นปุ่มนี้เลย (ดู Config ได้อย่างเดียว)
 *
 * เป็น UX-level gate เท่านั้น — การบังคับสิทธิ์จริงอยู่ที่ backend PermissionGuard
 * เสมอ · การเปิดฟอร์ม/refetch จัดการที่ตัวแม่ (`ConfigTableCard`)
 */
export function CreateConfigButton({ onClick }: { onClick: () => void }) {
  const { session } = useAuth();

  if (!canCreateConfig(session?.role)) return null;

  return <Button onClick={onClick}>+ สร้าง Config ใหม่</Button>;
}
