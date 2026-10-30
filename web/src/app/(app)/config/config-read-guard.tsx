"use client";

import { RoleGuard } from "@/components/auth/role-guard";
import { canReadConfig } from "@/lib/permissions";

/**
 * กันหน้า Config ทั้งหน้าสำหรับ Role ที่ไม่มี `config:Read` (FirmwareEngineer/QAEngineer)
 * เป็น Client Component เพราะ `RoleGuard` รับฟังก์ชัน `allow` ซึ่งส่งจาก Server Component
 * (page.tsx) ข้ามขอบเขตไม่ได้
 */
export function ConfigReadGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allow={canReadConfig}>{children}</RoleGuard>;
}
