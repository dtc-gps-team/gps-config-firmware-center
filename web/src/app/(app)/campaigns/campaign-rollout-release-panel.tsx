"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  rejectCampaignRollout,
  releaseCampaignRollout,
  RELEASABLE_CAMPAIGN_ROLLOUT_STATUS,
  type CampaignRollout,
} from "@/lib/campaign-api";
import { getTokenSubject } from "@/lib/jwt";
import { canDecideCampaignApproval } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type Decision = "release" | "reject";

/**
 * แผง "ปล่อยเข้าอุปกรณ์ / ปฏิเสธ" — แก้ครั้งที่ 63 (แยก "อนุมัติ" ออกจาก
 * "ปล่อยเข้าอุปกรณ์" เป็น 2 ขั้นตอน) โผล่เฉพาะสถานะ `approved` (รอ release)
 *
 * **แก้ครั้งที่ 63 ตามมา (review comment B บน PR #250):** เพิ่มปุ่ม "ปฏิเสธ"
 * กลับเข้ามา — เดิมตั้งใจไม่มี เพราะคิดว่า release อย่างเดียวพอ แต่พบว่า
 * ถ้า Operation อนุมัติไปแล้วเปลี่ยนใจ (เจอปัญหากับ Config/Firmware ทีหลัง
 * หรือลืมกลับมากดปล่อย) จะไม่มีทางถอยเลยนอกจากต้อง release จริงก่อนค่อย
 * rollback — ขัดเจตนาหลักของการแยก 2 ขั้นตอนนี้ (ควรมีจุดเช็คสุดท้ายก่อนแตะ
 * อุปกรณ์จริงได้ ไม่ใช่บังคับต้องแตะก่อนถึงจะถอยได้)
 *
 * - **ปล่อยเข้าอุปกรณ์**: **ไม่เช็ค Separation of Duty** (mirror resume —
 *   การอนุมัติเช็ค SoD ไปแล้วก่อนหน้านี้ ผู้อนุมัติเดิมเป็นคนกด release เอง
 *   ได้)
 * - **ปฏิเสธ**: เช็ค SoD เหมือน `CampaignRolloutApprovalPanel` เดิมทุกประการ
 *   (ผู้สร้าง Rollout ปฏิเสธของตัวเองไม่ได้ ไม่ว่าจะ reject จากสถานะไหนก็ตาม
 *   — ฝั่ง backend เช็คเหมือนกัน `assertDecidable()`)
 */
export function CampaignRolloutReleasePanel({
  campaignId,
  rollout,
  onReleased,
  onRejected,
}: {
  campaignId: string;
  rollout: CampaignRollout;
  onReleased: (updated: CampaignRollout) => void;
  onRejected: (updated: CampaignRollout) => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rollout.status !== RELEASABLE_CAMPAIGN_ROLLOUT_STATUS) {
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
        <p className="text-sm font-medium">รอ Operation ปล่อยเข้าอุปกรณ์</p>
        <p className="text-sm text-muted-foreground">
          Rollout นี้อนุมัติแล้ว แต่ยังไม่ถูกปล่อยเข้าอุปกรณ์จริง — เฉพาะ
          Operation เท่านั้นที่ปล่อย/ปฏิเสธได้
        </p>
      </div>
    );
  }

  async function run(decision: Decision) {
    if (!session?.accessToken) return;
    setPending(true);
    setError(null);
    try {
      if (decision === "release") {
        const updated = await releaseCampaignRollout(
          session.accessToken,
          campaignId,
          rollout.id,
        );
        toast.success("ปล่อย Rollout เข้าอุปกรณ์แล้ว");
        onReleased(updated);
      } else {
        const updated = await rejectCampaignRollout(
          session.accessToken,
          campaignId,
          rollout.id,
        );
        toast.success("ปฏิเสธ Rollout แล้ว");
        onRejected(updated);
      }
    } catch (err) {
      setPending(false);
      setConfirming(null);
      const message =
        err instanceof ApiError
          ? err.message
          : decision === "release"
            ? "ปล่อยเข้าอุปกรณ์ไม่สำเร็จ"
            : "ปฏิเสธไม่สำเร็จ";
      setError(message);
      toast.error(message);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm font-medium">ปล่อยเข้าอุปกรณ์</p>
      <p className="text-sm text-muted-foreground">
        Rollout นี้อนุมัติแล้ว — กดปล่อยเมื่อพร้อมส่ง Config/Firmware เข้าทุก
        เครื่องในกลุ่มจริง (เลือกจังหวะปล่อยเองได้ ไม่บังคับต้องปล่อยทันที)
        {!isOwnRollout &&
          " หรือกดปฏิเสธถ้าเปลี่ยนใจก่อนปล่อยจริง"}
      </p>
      {isOwnRollout && (
        <p className="text-xs text-muted-foreground">
          คุณเป็นผู้สร้าง Rollout นี้ — ปฏิเสธของตัวเองไม่ได้ (Separation of
          Duty) ปล่อยเข้าอุปกรณ์ได้ตามปกติ
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {confirming ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">
            {confirming === "release"
              ? "ปล่อย Rollout นี้เข้าอุปกรณ์เลยหรือไม่?"
              : "ปฏิเสธ Rollout นี้?"}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={confirming === "release" ? "default" : "destructive"}
              disabled={pending}
              onClick={() => void run(confirming)}
            >
              {pending
                ? "กำลังดำเนินการ…"
                : confirming === "release"
                  ? "ยืนยันปล่อยเข้าอุปกรณ์"
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
          {!isOwnRollout && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming("reject")}
            >
              ปฏิเสธ
            </Button>
          )}
          <Button size="sm" onClick={() => setConfirming("release")}>
            ปล่อยเข้าอุปกรณ์
          </Button>
        </div>
      )}
    </div>
  );
}
