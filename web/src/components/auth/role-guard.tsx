"use client";

import { useAuth } from "./auth-provider";

/**
 * Gate ทั้งหน้า (ไม่ใช่แค่ปุ่ม) — ใช้กับหน้าที่ RBAC_Matrix.md Section 2 ระบุ
 * ว่าบาง Role เป็น "-" หมดทั้งแถว (ไม่มีสิทธิ์เข้าถึงจอนี้เลย) เช่น Audit Log
 * (ยกเว้น SW) และ User Management (Admin เท่านั้น) — ต่างจากหน้าอื่นที่ทุก
 * Role อ่านได้หมด (แค่ปุ่ม action ต่างกัน ใช้ gate แบบซ่อนปุ่มพอ ดู
 * approval-actions.tsx เป็นตัวอย่าง)
 *
 * นี่คือ UX-level gate เท่านั้น (route จริงบน backend ยังไม่มี — endpoint
 * เหล่านี้อยู่ใน RBAC_Matrix.md ตาราง 4.2 "ยังไม่มีใน openapi.yaml") การบังคับ
 * สิทธิ์จริงต้องทำที่ backend guard ตอนเพิ่ม endpoint จริงเสมอ
 */
export function RoleGuard({
  allow,
  children,
}: {
  allow: (role: string | null | undefined) => boolean;
  children: React.ReactNode;
}) {
  const { isReady, session } = useAuth();

  // รอ session hydrate ก่อน (AuthProvider อ่าน localStorage หลัง mount) กัน
  // กระพริบ "ไม่มีสิทธิ์" ผิดๆ ให้คนที่มีสิทธิ์จริงเห็นแวบนึงตอนโหลดหน้า
  if (!isReady) return null;

  if (!allow(session?.role)) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        คุณไม่มีสิทธิ์เข้าถึงหน้านี้
      </div>
    );
  }

  return <>{children}</>;
}
