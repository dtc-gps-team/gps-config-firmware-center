"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { approveConfig, rejectConfig } from "@/lib/config-api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";

type Decision = "approve" | "reject";

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" ต่อ 1 Config — Operation เท่านั้น (RBAC_Matrix.md
 * Section 2 + Section 5 ข้อ 1, Separation of Duty) · role อื่นเห็นข้อความ
 * read-only แทน · การบังคับสิทธิ์จริงอยู่ที่ backend PermissionGuard เสมอ
 *
 * `reject` ยังไม่รับเหตุผล (endpoint ไม่มี field) — ยืนยันแล้วกดปฏิเสธเลย
 * ทั้งสองปุ่มผ่าน `ConfirmDialog` ที่บอกผลกระทบก่อนทำจริง
 */
export function ApprovalActions({
  configId,
  configName,
  canDecide,
  onDecided,
}: {
  configId: string;
  configName: string;
  canDecide: boolean;
  onDecided: (action: Decision) => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState<Decision | null>(null);
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
        await approveConfig(session.accessToken, configId);
      } else {
        await rejectConfig(session.accessToken, configId);
      }
      toast.success(
        decision === "approve"
          ? `อนุมัติ "${configName}" แล้ว`
          : `ปฏิเสธ "${configName}" แล้ว`,
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
        title={`${confirming === "reject" ? "ปฏิเสธ" : "อนุมัติ"} "${configName}"?`}
        description={
          confirming === "reject"
            ? "Config จะกลับเป็นสถานะถูกปฏิเสธ ผู้สร้างต้องแก้ไขแล้วส่งใหม่ ยังไม่ถูกนำไปใช้กับอุปกรณ์"
            : "Config จะเป็นสถานะอนุมัติแล้ว นำไปใช้ใน Rollout ได้ ยังไม่ถูกส่งเข้าอุปกรณ์จนกว่าจะเริ่ม Rollout"
        }
        confirmLabel={confirming === "reject" ? "ยืนยันปฏิเสธ" : "ยืนยันอนุมัติ"}
        destructive={confirming === "reject"}
        onConfirm={async () => {
          if (confirming) await run(confirming);
        }}
      />
    </div>
  );
}
