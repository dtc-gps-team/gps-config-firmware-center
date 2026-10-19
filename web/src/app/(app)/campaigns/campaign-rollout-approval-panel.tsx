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
import { Card } from "@/components/ui/card";
import { DisabledWithReason } from "@/components/disabled-with-reason";

type Decision = "approve" | "reject";

/**
 * แผง "อนุมัติ/ปฏิเสธ Rollout" — Operation เท่านั้น (Campaign Approval,
 * แก้ครั้งที่ 39) โผล่บนหน้ารายละเอียด Rollout เฉพาะสถานะ `pending_approval`
 * — แก้ไข 2026-09-24 (Campaign Monitor #22): เดิมชื่อ `CampaignApprovalPanel`
 * ทำงานกับ `Campaign` ตรงๆ ย้ายมาทำงานกับ `CampaignRollout` แทน (payload/
 * approval ย้ายไปอยู่ที่นั่นแล้ว) ตรรกะ SoD เหมือนเดิมทุกประการ — เทียบ
 * user id ผ่าน `getTokenSubject` มิเรอร์ `approval-center-view.tsx` เพราะ
 * `AuthSession` ไม่เก็บ user id ตรงๆ
 *
 * `variant="inline"` ใช้ในการ์ดคิว Approval Center: ไม่มีกล่องเทาและหัวข้อ
 * ให้ปุ่มและข้อความหน้าตาเดียวกับการ์ดคำขอประเภทอื่นในคิว ส่วนหน้ารายละเอียด
 * Rollout ใช้ค่าเริ่มต้น `"panel"` (กล่องเทาเหมือนเดิม)
 */
const OWN_ROLLOUT_REASON =
  "คุณเป็นผู้สร้าง Rollout นี้ อนุมัติหรือปฏิเสธของตัวเองไม่ได้ ต้องให้ Operation คนอื่นตัดสินใจ";

export function CampaignRolloutApprovalPanel({
  campaignId,
  rollout,
  onDecided,
  variant = "panel",
}: {
  campaignId: string;
  rollout: CampaignRollout;
  onDecided: (updated: CampaignRollout) => void;
  variant?: "panel" | "inline";
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

  const inline = variant === "inline";

  if (!canDecide) {
    if (inline) {
      return (
        <span className="text-sm text-muted-foreground">
          เฉพาะ Operation เท่านั้นที่อนุมัติ/ปฏิเสธได้
        </span>
      );
    }
    return (
      <Card className="max-w-2xl gap-1 bg-muted/30 p-4">
        <p className="text-sm font-medium">รอ Operation อนุมัติ</p>
        <p className="text-sm text-muted-foreground">
          Rollout นี้ยังไม่ได้รับการอนุมัติ เฉพาะ Operation
          เท่านั้นที่อนุมัติ/ปฏิเสธได้
        </p>
      </Card>
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

  const controls = (
    <>
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
          {isOwnRollout ? (
            // Separation of Duty — ผู้สร้างรอบอนุมัติ/ปฏิเสธของตัวเองไม่ได้
            // (backend บังคับอยู่แล้ว) แสดงปุ่มแบบ disable พร้อมเหตุผล แทนการ
            // ซ่อนปุ่มทิ้ง เพราะ Operation คาดว่าจะเห็นปุ่มนี้
            <DisabledWithReason reason={OWN_ROLLOUT_REASON}>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled>
                  ปฏิเสธ
                </Button>
                <Button size="sm" disabled>
                  อนุมัติ
                </Button>
              </div>
            </DisabledWithReason>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </>
  );

  if (inline) {
    return <div className="flex flex-col items-start gap-1">{controls}</div>;
  }

  return (
    <Card className="max-w-2xl gap-3 bg-muted/30 p-4">
      <p className="text-sm font-medium">
        {isOwnRollout ? "รอ Operation คนอื่นอนุมัติ" : "อนุมัติ Rollout"}
      </p>
      <p className="text-sm text-muted-foreground">
        อนุมัติแล้วยังไม่แตะอุปกรณ์ ต้องกด &ldquo;ปล่อยเข้าอุปกรณ์&rdquo;
        อีกขั้นถึงจะเริ่มทำงานจริง ปฏิเสธแล้วผู้สร้างเปิดรอบใหม่ได้
      </p>
      {controls}
    </Card>
  );
}
