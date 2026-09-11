"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { approveConfig, rejectConfig } from "@/lib/config-api";
import { Button } from "@/components/ui/button";

type Decision = "approve" | "reject";

/**
 * ปุ่ม "อนุมัติ" / "ปฏิเสธ" ต่อ 1 Config — Operation เท่านั้น (RBAC_Matrix.md
 * Section 2 + Section 5 ข้อ 1, Separation of Duty) · role อื่นเห็นข้อความ
 * read-only แทน · การบังคับสิทธิ์จริงอยู่ที่ backend PermissionGuard เสมอ
 *
 * `reject` ยังไม่รับเหตุผล (endpoint ไม่มี field) — ยืนยันแล้วกดปฏิเสธเลย
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
      onDecided(decision);
    } catch (err) {
      setPending(false);
      setConfirming(null);
      setError(
        err instanceof ApiError
          ? err.message
          : decision === "approve"
            ? "อนุมัติไม่สำเร็จ"
            : "ปฏิเสธไม่สำเร็จ",
      );
    }
  }

  if (confirming) {
    const isApprove = confirming === "approve";
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="text-sm">
          {isApprove ? "อนุมัติ" : "ปฏิเสธ"} &ldquo;{configName}&rdquo;?
        </p>
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
    <div className="flex flex-col items-end gap-1">
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
