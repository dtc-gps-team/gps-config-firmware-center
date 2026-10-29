"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  approveFieldApplyRequest,
  rejectFieldApplyRequest,
} from "@/lib/field-apply-request-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Decision = "approve" | "reject";

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" ต่อคำขอส่ง Config/Firmware เข้ากล่องจากหน้างาน 1
 * รายการ — Operation เท่านั้น (docs/25 §3.4) · ต่างจาก
 * `DeviceConfigOverrideApprovalActions`/`DeviceFirmwareOverrideApprovalActions`
 * ตรงที่ `rejectReason` **บังคับ** (ปุ่มยืนยันปฏิเสธ disable จนกว่าจะกรอก) —
 * ตรงกับ `ConfigApplyRequestRejectRequest` (`required: [rejectReason]`,
 * minLength 1) ไม่ใช่ optional เหมือน Device Override
 */
export function FieldApplyRequestApprovalActions({
  id,
  deviceId,
  canDecide,
  sodBlockedReason,
  onDecided,
}: {
  id: string;
  deviceId: string;
  canDecide: boolean;
  /** เหตุผลที่ผู้ใช้คนนี้โดยเฉพาะอนุมัติคำขอนี้ไม่ได้ (SoD เทียบ user id ฝั่ง
   * client ล่วงหน้า) — ไม่ครอบคลุม Config.approvedBy เพราะ list endpoint
   * ไม่คืนค่านี้ กรณีนั้นยังต้องกดแล้วเจอ 403 จาก backend เหมือนเดิม */
  sodBlockedReason?: string | null;
  onDecided: (action: Decision) => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canDecide) {
    return (
      <span className="text-sm text-muted-foreground">
        เฉพาะ Operation เท่านั้นที่อนุมัติ/ปฏิเสธได้
      </span>
    );
  }

  if (sodBlockedReason) {
    return (
      <span className="text-sm text-muted-foreground">
        {sodBlockedReason}
      </span>
    );
  }

  async function run(decision: Decision) {
    if (!session?.accessToken) return;
    const trimmed = rejectReason.trim();
    if (decision === "reject" && !trimmed) return;
    setPending(true);
    setError(null);
    try {
      if (decision === "approve") {
        await approveFieldApplyRequest(session.accessToken, id);
      } else {
        await rejectFieldApplyRequest(session.accessToken, id, {
          rejectReason: trimmed,
        });
      }
      toast.success(
        decision === "approve"
          ? `อนุมัติคำขอของ ${deviceId} แล้ว`
          : `ปฏิเสธคำขอของ ${deviceId} แล้ว`,
      );
      onDecided(decision);
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

  if (confirming) {
    const isApprove = confirming === "approve";
    const trimmed = rejectReason.trim();
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm">
          {isApprove ? "อนุมัติ" : "ปฏิเสธ"}คำขอของ{" "}
          <span className="font-mono">{deviceId}</span>?
        </p>
        {!isApprove && (
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="เหตุผลที่ปฏิเสธ (บังคับ)"
            maxLength={500}
            className="h-8 w-64 text-xs"
          />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={isApprove ? "default" : "destructive"}
            disabled={pending || (!isApprove && !trimmed)}
            onClick={() => void run(confirming)}
          >
            {pending
              ? "กำลังดำเนินการ…"
              : isApprove
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
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {error && <p className="text-xs text-destructive">{error}</p>}
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
    </div>
  );
}
