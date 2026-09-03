"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canDecideConfigApproval } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" — Operation เท่านั้น (RBAC_Matrix.md Section 2 +
 * Section 5 ข้อ 1, Separation of Duty) role อื่นเห็นแค่สถานะ read-only แทน
 *
 * ปุ่มเป็น scaffold `disabled` อยู่แล้ว รอต่อ POST /config/{configId}/approve
 * และ /reject จริง — component นี้คุมแค่ว่า "ควรเห็นปุ่มนี้ไหม" (UX-level
 * gate เท่านั้น การบังคับสิทธิ์จริงอยู่ที่ backend PermissionGuard เสมอ)
 */
export function ApprovalActions() {
  const { session } = useAuth();

  if (!canDecideConfigApproval(session?.role)) {
    return (
      <span className="text-sm text-muted-foreground">
        เฉพาะ Operation เท่านั้นที่อนุมัติ/ปฏิเสธได้
      </span>
    );
  }

  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" disabled>
        ปฏิเสธ
      </Button>
      <Button size="sm" disabled>
        อนุมัติ
      </Button>
    </div>
  );
}
