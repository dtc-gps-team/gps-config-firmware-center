"use client";

import { useAuth } from "@/components/auth/auth-provider";
import {
  canDecideFieldReport,
  canEditIncidentTechnical,
} from "@/lib/permissions";
import {
  FIELD_REPORT_SOURCE,
  type Incident,
  type IncidentDecisionOutcome,
  type IncidentDecisionResult,
} from "@/lib/incident-api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DecideFieldReportDialog } from "./decide-field-report-dialog";

/**
 * ปุ่ม "แก้ไขเชิงเทคนิค" (ST) — RBAC_Matrix.md Section 2 แถว Incident &
 * Rollback: role อื่นไม่เห็นปุ่มไหนเลย (ดูได้อย่างเดียว)
 *
 * **ปุ่ม "สั่ง Rollback" (Operation) ถูกเอาออกแล้ว** (แก้ไข 2026-09-29) —
 * ไม่ใช่แค่ mirror `campaignRollout.rollback()` (ย้ายไปอยู่ Campaign Monitor
 * ตั้งแต่แก้ครั้งที่ 59) แต่ "Rollback" ที่ PDF หมายถึงจริงสำหรับ Incident
 * Center (§12.2: "Impact Analysis, Suspend, Hotfix, Rollback, Root Cause")
 * คือการสร้าง **Hotfix Campaign** ตอบสนอง Firmware Incident ทั้งเวอร์ชัน
 * (§11.1) — ฟีเจอร์ใหญ่กว่ามากที่ยังไม่เคยออกแบบเลย (Suspend Firmware,
 * Block อุปกรณ์ใหม่, แจ้งเตือน Operation/Support/ลูกค้า, เก็บ Root
 * Cause/Impact/Workaround/Corrective Action — ไม่มี field พวกนี้ใน
 * `Incident` model เลยสักตัว) ปุ่ม scaffold เดิมจึงไม่ได้ชี้ไปที่อะไรจริง
 * อีกต่อไป ตัดออกดีกว่าปล่อยไว้ให้สับสน — ถ้าจะทำ Incident Center เต็มรูป
 * ตาม PDF เป็นงานสโคปใหม่แยกต่างหาก
 *
 * **ปุ่ม "ตัดสินใจ" (Operation)** เพิ่มใหม่ (issue #284, backend `POST
 * /incidents/{id}/decide`) — เฉพาะ Field Report ที่ยัง `open` role อื่นหรือ
 * รายการอื่นเห็น "ดูได้อย่างเดียว" เหมือนเดิม
 */
export function IncidentActions({
  incident,
  onDecided,
  onStale,
}: {
  incident: Incident;
  onDecided: (
    result: IncidentDecisionResult,
    outcome: IncidentDecisionOutcome,
  ) => void;
  onStale: () => void;
}) {
  const { session } = useAuth();
  const role = session?.role;

  const isOpenFieldReport =
    incident.source === FIELD_REPORT_SOURCE && incident.status === "open";
  if (isOpenFieldReport && canDecideFieldReport(role)) {
    return (
      <div className="flex justify-end">
        <DecideFieldReportDialog
          incident={incident}
          onDecided={onDecided}
          onStale={onStale}
        />
      </div>
    );
  }

  const showTechnicalFix = canEditIncidentTechnical(role);

  if (!showTechnicalFix) {
    return (
      <span className="text-sm text-muted-foreground">ดูได้อย่างเดียว</span>
    );
  }

  return (
    <div className="flex justify-end gap-2">
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button variant="outline" size="sm" disabled>
            แก้ไขเชิงเทคนิค
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          ยังไม่รองรับ รอ endpoint แก้ไขเชิงเทคนิค (ยังไม่มีใน spec)
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
