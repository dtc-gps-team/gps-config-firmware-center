"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  releaseCampaignRollout,
  RELEASABLE_CAMPAIGN_ROLLOUT_STATUS,
  type CampaignRollout,
} from "@/lib/campaign-api";
import { canDecideCampaignApproval } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/**
 * แผง "ปล่อยเข้าอุปกรณ์" — แก้ครั้งที่ 63 (แยก "อนุมัติ" ออกจาก "ปล่อยเข้า
 * อุปกรณ์" เป็น 2 ขั้นตอน) โผล่เฉพาะสถานะ `approved` (รอ release) mirror
 * `CampaignRolloutApprovalPanel` แต่เรียบง่ายกว่า — ไม่มี reject, **ไม่เช็ค
 * Separation of Duty** (mirror resume — การอนุมัติเช็ค SoD ไปแล้วก่อนหน้านี้
 * ผู้อนุมัติเดิมเป็นคนกด release เองก็ได้) ใช้สิทธิ์เดียวกับ approval panel
 * (`canDecideCampaignApproval`) เพราะเป็น resource/action เดียวกันฝั่ง
 * backend — ใช้ร่วม 2 ที่เหมือน approval panel เดิม (Rollout Detail +
 * Approval Center)
 */
export function CampaignRolloutReleasePanel({
  campaignId,
  rollout,
  onReleased,
}: {
  campaignId: string;
  rollout: CampaignRollout;
  onReleased: (updated: CampaignRollout) => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rollout.status !== RELEASABLE_CAMPAIGN_ROLLOUT_STATUS) {
    return null;
  }

  const canRelease = canDecideCampaignApproval(session?.role);

  if (!canRelease) {
    return (
      <div className="flex max-w-2xl flex-col gap-1 rounded-xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">รอ Operation ปล่อยเข้าอุปกรณ์</p>
        <p className="text-sm text-muted-foreground">
          Rollout นี้อนุมัติแล้ว แต่ยังไม่ถูกปล่อยเข้าอุปกรณ์จริง — เฉพาะ
          Operation เท่านั้นที่ปล่อยได้
        </p>
      </div>
    );
  }

  async function run() {
    if (!session?.accessToken) return;
    setPending(true);
    setError(null);
    try {
      const updated = await releaseCampaignRollout(
        session.accessToken,
        campaignId,
        rollout.id,
      );
      toast.success("ปล่อย Rollout เข้าอุปกรณ์แล้ว");
      onReleased(updated);
    } catch (err) {
      setPending(false);
      setConfirming(false);
      const message =
        err instanceof ApiError ? err.message : "ปล่อยเข้าอุปกรณ์ไม่สำเร็จ";
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
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {confirming ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">ปล่อย Rollout นี้เข้าอุปกรณ์เลยหรือไม่?</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => void run()}>
              {pending ? "กำลังปล่อย…" : "ยืนยันปล่อยเข้าอุปกรณ์"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              ยกเลิก
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setConfirming(true)}>
            ปล่อยเข้าอุปกรณ์
          </Button>
        </div>
      )}
    </div>
  );
}
