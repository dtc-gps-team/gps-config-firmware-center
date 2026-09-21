"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { approveFirmware, rejectFirmware, type Firmware } from "@/lib/firmware-api";
import { canDecideFirmwareApproval } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type Decision = "approve" | "reject";

/**
 * แผง "อนุมัติ/ปฏิเสธคุณภาพ" — QAEngineer เท่านั้น (Firmware Approval
 * Lifecycle, docs/13_Role_Redesign_Proposal.md §3.2) โผล่บนหน้ารายละเอียด
 * Firmware เฉพาะสถานะ `pending_review` · mirror `ApprovalActions` ฝั่ง
 * Approval Center (Config) แต่ผู้ตัดสินใจมีแค่คนเดียว (QA) ไม่มีขั้น "ส่งต่อ"
 * แบบ ConfigEngineer → Operation
 */
export function FirmwareApprovalPanel({
  firmware,
  onDecided,
}: {
  firmware: Firmware;
  onDecided: (updated: Firmware) => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (firmware.approvalStatus !== "pending_review") {
    return null;
  }

  if (!canDecideFirmwareApproval(session?.role)) {
    return (
      <div className="flex max-w-2xl flex-col gap-1 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">รอ QA Engineer ตรวจคุณภาพ</p>
        <p className="text-sm text-muted-foreground">
          Firmware เวอร์ชันนี้ยังไม่ได้รับการอนุมัติคุณภาพ — เฉพาะ QA Engineer
          เท่านั้นที่อนุมัติ/ปฏิเสธได้
        </p>
      </div>
    );
  }

  async function run(decision: Decision) {
    if (!session?.accessToken) return;
    setPending(true);
    setError(null);
    try {
      const updated =
        decision === "approve"
          ? await approveFirmware(session.accessToken, firmware.id)
          : await rejectFirmware(session.accessToken, firmware.id);
      toast.success(
        decision === "approve"
          ? `อนุมัติคุณภาพ "${firmware.version}" แล้ว`
          : `ปฏิเสธคุณภาพ "${firmware.version}" แล้ว`,
      );
      onDecided(updated);
    } catch (err) {
      setPending(false);
      setConfirming(null);
      const message =
        err instanceof ApiError
          ? err.message
          : decision === "approve"
            ? "อนุมัติไม่สำเร็จ"
            : "ปฏิเสธไม่สำเร็จ";
      setError(message);
      toast.error(message);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm font-medium">อนุมัติคุณภาพ Firmware</p>
      <p className="text-sm text-muted-foreground">
        ดูผลทดสอบด้านบนก่อนตัดสินใจ — อนุมัติแล้วใช้สร้างแคมเปญได้ทันที
        ปฏิเสธแล้ว Firmware Engineer ต้องอัปโหลดเวอร์ชันใหม่แก้ไข
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {confirming ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">
            {confirming === "approve" ? "อนุมัติ" : "ปฏิเสธ"} คุณภาพเวอร์ชัน
            &ldquo;{firmware.version}&rdquo;?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={confirming === "approve" ? "default" : "destructive"}
              disabled={pending}
              onClick={() => void run(confirming)}
            >
              {pending
                ? "กำลังดำเนินการ…"
                : confirming === "approve"
                  ? "ยืนยันอนุมัติ"
                  : "ยืนยันปฏิเสธ"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(null)}
            >
              ยกเลิก
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirming("reject")}
          >
            ปฏิเสธ
          </Button>
          <Button size="sm" onClick={() => setConfirming("approve")}>
            อนุมัติ
          </Button>
        </div>
      )}
    </div>
  );
}
