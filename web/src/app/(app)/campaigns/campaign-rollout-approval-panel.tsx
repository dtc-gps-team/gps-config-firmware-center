"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  approveCampaignRollout,
  rejectCampaignRollout,
  type CampaignRollout,
} from "@/lib/campaign-api";
import { getTokenSubject } from "@/lib/jwt";
import { canDecideCampaignApproval } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type Decision = "approve" | "reject";

/**
 * แผง "อนุมัติ/ปฏิเสธ Rollout" — Operation เท่านั้น (Campaign Approval,
 * แก้ครั้งที่ 39) โผล่บนหน้ารายละเอียด Rollout เฉพาะสถานะ `pending_approval`
 * — แก้ไข 2026-09-24 (Campaign Monitor #22): เดิมชื่อ `CampaignApprovalPanel`
 * ทำงานกับ `Campaign` ตรงๆ ย้ายมาทำงานกับ `CampaignRollout` แทน (payload/
 * approval ย้ายไปอยู่ที่นั่นแล้ว) ตรรกะ SoD เหมือนเดิมทุกประการ — เทียบ
 * user id ผ่าน `getTokenSubject` มิเรอร์ `approval-center-view.tsx` เพราะ
 * `AuthSession` ไม่เก็บ user id ตรงๆ
 */
export function CampaignRolloutApprovalPanel({
  campaignId,
  rollout,
  onDecided,
}: {
  campaignId: string;
  rollout: CampaignRollout;
  onDecided: (updated: CampaignRollout) => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rollout.status !== "pending_approval") {
    return null;
  }

  const canDecide = canDecideCampaignApproval(session?.role);
  const myUserId = session?.accessToken
    ? getTokenSubject(session.accessToken)
    : null;
  const isOwnRollout = myUserId !== null && myUserId === rollout.createdBy;

  if (!canDecide) {
    return (
      <div className="flex max-w-2xl flex-col gap-1 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">รอ Operation อนุมัติ</p>
        <p className="text-sm text-muted-foreground">
          Rollout นี้ยังไม่ได้รับการอนุมัติ — เฉพาะ Operation
          เท่านั้นที่อนุมัติ/ปฏิเสธได้
        </p>
      </div>
    );
  }

  if (isOwnRollout) {
    return (
      <div className="flex max-w-2xl flex-col gap-1 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">รอ Operation อีกคนอนุมัติ</p>
        <p className="text-sm text-muted-foreground">
          คุณเป็นผู้สร้าง Rollout นี้ — อนุมัติ/ปฏิเสธของตัวเองไม่ได้
          (Separation of Duty) ต้องรอ Operation คนอื่นตัดสินใจ
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
          ? await approveCampaignRollout(
              session.accessToken,
              campaignId,
              rollout.id,
            )
          : await rejectCampaignRollout(
              session.accessToken,
              campaignId,
              rollout.id,
            );
      toast.success(
        decision === "approve" ? "อนุมัติ Rollout แล้ว" : "ปฏิเสธ Rollout แล้ว",
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
      <p className="text-sm font-medium">อนุมัติ Rollout</p>
      <p className="text-sm text-muted-foreground">
        อนุมัติแล้ว Rollout เริ่มทำงานทันที ปฏิเสธแล้วผู้สร้างเปิดรอบใหม่ได้
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {confirming ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">
            {confirming === "approve" ? "อนุมัติ" : "ปฏิเสธ"} Rollout นี้?
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
