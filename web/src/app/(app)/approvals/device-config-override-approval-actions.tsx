"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  approveDeviceConfigOverride,
  rejectDeviceConfigOverride,
} from "@/lib/device-config-override-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Decision = "approve" | "reject";

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" ต่อคำขอ Per-device Config Override 1 รายการ —
 * Operation เท่านั้น (issue #223, มติ 2026-09-24) — mirror `approval-actions.tsx`
 * ต่างจากที่นั่นตรงที่ reject รับ `rejectReason` (optional) ได้ เพราะ endpoint
 * นี้มี field นี้จริง (ST เห็นเหตุผลปฏิเสธได้ ต่างจาก Config reject เดิม)
 */
export function DeviceConfigOverrideApprovalActions({
  id,
  deviceId,
  canDecide,
  onDecided,
}: {
  id: string;
  deviceId: string;
  canDecide: boolean;
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

  async function run(decision: Decision) {
    if (!session?.accessToken) return;
    setPending(true);
    setError(null);
    try {
      if (decision === "approve") {
        await approveDeviceConfigOverride(session.accessToken, id);
      } else {
        const trimmed = rejectReason.trim();
        await rejectDeviceConfigOverride(
          session.accessToken,
          id,
          trimmed ? { rejectReason: trimmed } : undefined,
        );
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
            placeholder="เหตุผลที่ปฏิเสธ (ไม่บังคับ)"
            maxLength={500}
            className="h-8 w-64 text-xs"
          />
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={isApprove ? "default" : "destructive"}
            disabled={pending}
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
