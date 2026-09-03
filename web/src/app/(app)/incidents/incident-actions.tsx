"use client";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideIncidentRollback,
  canEditIncidentTechnical,
} from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * ปุ่ม "สั่ง Rollback" (Operation) และ "แก้ไขเชิงเทคนิค" (ST) — RBAC_Matrix.md
 * Section 2 แถว Incident & Rollback: 2 บทบาทแยกกันชัดเจน คนละปุ่ม role อื่น
 * ไม่เห็นปุ่มไหนเลย (SW/OT/Auditor/Admin ดูได้อย่างเดียว)
 *
 * ปุ่มเป็น scaffold `disabled` อยู่แล้ว รอต่อ endpoint จริง (ยังไม่มีโมดูล
 * `incident` ใน spec — ดู RBAC_Matrix.md ตาราง 4.2) component นี้คุมแค่ว่า
 * "ควรเห็นปุ่มไหนบ้าง" (UX-level gate เท่านั้น)
 */
export function IncidentActions() {
  const { session } = useAuth();
  const role = session?.role;

  const showRollback = canDecideIncidentRollback(role);
  const showTechnicalFix = canEditIncidentTechnical(role);

  if (!showRollback && !showTechnicalFix) {
    return (
      <span className="text-sm text-muted-foreground">ดูได้อย่างเดียว</span>
    );
  }

  return (
    <div className="flex justify-end gap-2">
      {showTechnicalFix && (
        <Button variant="outline" size="sm" disabled>
          แก้ไขเชิงเทคนิค
        </Button>
      )}
      {showRollback && (
        <Button size="sm" disabled>
          สั่ง Rollback
        </Button>
      )}
    </div>
  );
}
