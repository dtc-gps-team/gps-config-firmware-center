"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { approveCampaign, rejectCampaign, type Campaign } from "@/lib/campaign-api";
import { getTokenSubject } from "@/lib/jwt";
import { canDecideCampaignApproval } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type Decision = "approve" | "reject";

/**
 * แผง "อนุมัติ/ปฏิเสธ Campaign" — Operation เท่านั้น (Campaign Approval,
 * แก้ครั้งที่ 39) โผล่บนหน้ารายละเอียด Campaign เฉพาะสถานะ `pending_approval`
 * mirror `FirmwareApprovalPanel` แต่เพิ่มเช็ค Separation of Duty ที่ตัวเอง
 * (ผู้สร้าง Campaign อนุมัติ/ปฏิเสธของตัวเองไม่ได้ — backend บังคับจริงอยู่
 * แล้ว ที่นี่แค่ซ่อน/อธิบายปุ่มล่วงหน้า) เทียบ user id ผ่าน `getTokenSubject`
 * มิเรอร์ `approval-center-view.tsx` เพราะ `AuthSession` ไม่เก็บ user id ตรงๆ
 */
export function CampaignApprovalPanel({
  campaign,
  onDecided,
}: {
  campaign: Campaign;
  onDecided: (updated: Campaign) => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (campaign.status !== "pending_approval") {
    return null;
  }

  const canDecide = canDecideCampaignApproval(session?.role);
  const myUserId = session?.accessToken
    ? getTokenSubject(session.accessToken)
    : null;
  const isOwnCampaign = myUserId !== null && myUserId === campaign.createdBy;

  if (!canDecide) {
    return (
      <div className="flex max-w-2xl flex-col gap-1 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">รอ Operation อนุมัติ</p>
        <p className="text-sm text-muted-foreground">
          แคมเปญนี้ยังไม่ได้รับการอนุมัติ — เฉพาะ Operation
          เท่านั้นที่อนุมัติ/ปฏิเสธได้
        </p>
      </div>
    );
  }

  if (isOwnCampaign) {
    return (
      <div className="flex max-w-2xl flex-col gap-1 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">รอ Operation อีกคนอนุมัติ</p>
        <p className="text-sm text-muted-foreground">
          คุณเป็นผู้สร้างแคมเปญนี้ — อนุมัติ/ปฏิเสธของตัวเองไม่ได้
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
          ? await approveCampaign(session.accessToken, campaign.id)
          : await rejectCampaign(session.accessToken, campaign.id);
      toast.success(
        decision === "approve"
          ? `อนุมัติ "${campaign.name}" แล้ว`
          : `ปฏิเสธ "${campaign.name}" แล้ว`,
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
      <p className="text-sm font-medium">อนุมัติแคมเปญ</p>
      <p className="text-sm text-muted-foreground">
        อนุมัติแล้วแคมเปญเริ่มทำงานทันที ปฏิเสธแล้วผู้สร้างแก้ไขและส่งอนุมัติใหม่ได้
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {confirming ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">
            {confirming === "approve" ? "อนุมัติ" : "ปฏิเสธ"} แคมเปญ
            &ldquo;{campaign.name}&rdquo;?
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
