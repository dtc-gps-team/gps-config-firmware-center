"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { buttonVariants } from "@/components/ui/button";

/**
 * ปุ่ม "+ สร้าง Config ใหม่" — SW เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Config Editor) role อื่นไม่เห็นปุ่มนี้เลย (ดู Config ได้อย่างเดียว)
 *
 * เป็น UX-level gate เท่านั้น — การบังคับสิทธิ์จริงอยู่ที่ backend PermissionGuard
 * เสมอ · พาไปหน้า wizard `/config/new`
 */
export function CreateConfigButton() {
  const { session } = useAuth();

  if (!canCreateConfig(session?.role)) return null;

  return (
    <Link href="/config/new" className={buttonVariants()}>
      + สร้าง Config ใหม่
    </Link>
  );
}
