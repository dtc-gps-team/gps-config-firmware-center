"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canUploadFirmware } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * ปุ่ม "+ อัปโหลด Firmware" — SW เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Firmware Repository) role อื่นไม่เห็นปุ่มนี้เลย (ดู Firmware ได้อย่างเดียว)
 *
 * ปุ่มเป็น scaffold `disabled` อยู่แล้ว รอต่อ POST /firmware จริง — component
 * นี้คุมแค่ว่า "ควรเห็นปุ่มนี้ไหม" (UX-level gate เท่านั้น การบังคับสิทธิ์จริง
 * อยู่ที่ backend PermissionGuard เสมอ)
 */
export function UploadFirmwareButton() {
  const { session } = useAuth();

  if (!canUploadFirmware(session?.role)) return null;

  return <Button disabled>+ อัปโหลด Firmware</Button>;
}
