"use client";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideIncidentRollback,
  canEditIncidentTechnical,
} from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * ปุ่ม "สั่ง Rollback" (Operation) และ "แก้ไขเชิงเทคนิค" (ST) — RBAC_Matrix.md
 * Section 2 แถว Incident & Rollback: 2 บทบาทแยกกันชัดเจน คนละปุ่ม role อื่น
 * ไม่เห็นปุ่มไหนเลย (ConfigEngineer/FirmwareEngineer/QAEngineer/OT/Auditor/Admin ดูได้อย่างเดียว)
 *
 * ปุ่มเป็น scaffold `disabled` อยู่แล้ว รอต่อ endpoint เขียน (Update/Rollback)
 * — `GET /incidents` ต่อจริงแล้ว (ดู `incidents-view.tsx`) แต่ยังไม่มี
 * endpoint ให้ ST แก้ไขเชิงเทคนิค/Operation สั่ง Rollback เลย (ดู
 * RBAC_Matrix.md ตาราง 4.2) component นี้คุมแค่ว่า "ควรเห็นปุ่มไหนบ้าง"
 * (UX-level gate เท่านั้น)
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
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Button variant="outline" size="sm" disabled>
              แก้ไขเชิงเทคนิค
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            ยังไม่รองรับ — รอ endpoint แก้ไขเชิงเทคนิค (ยังไม่มีใน spec)
          </TooltipContent>
        </Tooltip>
      )}
      {showRollback && (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Button size="sm" disabled>
              สั่ง Rollback
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            ยังไม่รองรับ — รอ endpoint สั่ง Rollback (ยังไม่มีใน spec)
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
