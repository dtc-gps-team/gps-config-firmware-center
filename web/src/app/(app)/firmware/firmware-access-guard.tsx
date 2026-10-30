"use client";

import { RoleGuard } from "@/components/auth/role-guard";
import { canReadFirmware } from "@/lib/permissions";

/**
 * ปิดหน้า Firmware สำหรับ Role ที่ไม่มีสิทธิ์อ่าน (ConfigEngineer) — ต้องเป็น client component
 * เพราะส่งฟังก์ชัน `allow` จากหน้า server เข้า RoleGuard ตรงๆ ไม่ได้ (Next.js ห้ามส่งฟังก์ชันข้ามขอบ server/client)
 */
export function FirmwareAccessGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allow={canReadFirmware}>{children}</RoleGuard>;
}
