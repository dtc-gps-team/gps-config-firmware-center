"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  approveDeviceFirmwareOverride,
  rejectDeviceFirmwareOverride,
} from "@/lib/device-firmware-override-api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Decision = "approve" | "reject";

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" ต่อคำขอ Firmware Override รายเครื่อง 1 รายการ —
 * Operation เท่านั้น (Sprint 3 แถวที่ 24) — mirror
 * `device-config-override-approval-actions.tsx` ทุกประการ
 */
export function DeviceFirmwareOverrideApprovalActions({
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
        await approveDeviceFirmwareOverride(session.accessToken, id);
      } else {
        const trimmed = rejectReason.trim();
        await rejectDeviceFirmwareOverride(
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
      setPending(false);
      setConfirming(null);
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
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(null);
        }}
        title={`${confirming === "reject" ? "ปฏิเสธ" : "อนุมัติ"}คำขอของ ${deviceId}?`}
        description={
          confirming === "reject"
            ? "ผู้ส่งคำขอจะเห็นว่าถูกปฏิเสธพร้อมเหตุผล (ถ้าใส่)"
            : "อนุมัติแล้วช่างกดยืนยันติดตั้ง Firmware นี้กับเครื่องนั้นได้ ไม่ได้สั่งติดตั้งอัตโนมัติ"
        }
        confirmLabel={confirming === "reject" ? "ยืนยันปฏิเสธ" : "ยืนยันอนุมัติ"}
        destructive={confirming === "reject"}
        onConfirm={async () => {
          if (confirming) await run(confirming);
        }}
      >
        {confirming === "reject" && (
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="เหตุผลที่ปฏิเสธ (ไม่บังคับ)"
            maxLength={500}
            aria-label="เหตุผลที่ปฏิเสธ"
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
