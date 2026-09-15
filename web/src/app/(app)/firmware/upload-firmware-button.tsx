"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { canUploadFirmware } from "@/lib/permissions";
import { buttonVariants } from "@/components/ui/button";

/**
 * ปุ่ม "+ อัปโหลด Firmware" — SW เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Firmware Repository) role อื่นไม่เห็นปุ่มนี้เลย (ดู Firmware ได้อย่างเดียว)
 *
 * เดิมเป็นปุ่ม scaffold `disabled` — ต่อจริงแล้วพาไปหน้า `/firmware/upload`
 * (หน้าเต็มแทน Dialog เพราะต้องมีที่โชว์ error/ผลอัปโหลด mirror
 * `ImportConfigButton`/`/config/import`) — เป็น UX-level gate เท่านั้น
 * backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function UploadFirmwareButton() {
  const { session } = useAuth();

  if (!canUploadFirmware(session?.role)) return null;

  return (
    <Link href="/firmware/upload" className={buttonVariants({ size: "sm" })}>
      + อัปโหลด Firmware
    </Link>
  );
}
