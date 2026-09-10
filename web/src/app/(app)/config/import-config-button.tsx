"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { buttonVariants } from "@/components/ui/button";

/**
 * ปุ่ม "Import จากไฟล์" ในหน้า Config Editor — SW เท่านั้น (RBAC_Matrix.md
 * Section 2 แถว Config Import) role อื่นไม่เห็นปุ่มนี้
 *
 * เป็น UX-level gate เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ ·
 * พาไปหน้า `/config/import` (Build Reference §3.1 อยากได้จุดเข้าจาก Config
 * Editor — ทำเป็นหน้าเต็มแทน Dialog เพราะต้องมีที่โชว์ preview + รายการ error)
 */
export function ImportConfigButton() {
  const { session } = useAuth();

  if (!canCreateConfig(session?.role)) return null;

  return (
    <Link
      href="/config/import"
      className={buttonVariants({ variant: "outline" })}
    >
      Import จากไฟล์
    </Link>
  );
}
