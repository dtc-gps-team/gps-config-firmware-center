"use client";

import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/auth/auth-provider";
import { InfoRow } from "@/components/info-row";
import { useCampaign } from "@/hooks/use-campaign";
import { ApiError } from "@/lib/api";
import { updateCampaign, type CampaignRolloutStatus } from "@/lib/campaign-api";
import { canManageCampaign } from "@/lib/permissions";

/** สถานะ Rollout ที่การลองส่งใหม่ยังมีผล (หลังจากนี้ปิดหรือเปิดสวิตช์ก็ไม่เปลี่ยนอะไรในรอบนี้) */
const RETRY_RELEVANT_STATUSES: readonly CampaignRolloutStatus[] = [
  "active",
  "paused",
];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * แถว "ลองส่งใหม่อัตโนมัติ" ในแถบข้างของหน้า Rollout (docs/31 §6.4) — สวิตช์เป็นของกลุ่ม (Campaign) ทุก Rollout ของกลุ่ม
 * ใช้ค่าเดียวกัน แต่หน้านี้คือที่ที่ Operation เห็นเครื่องล้มและอยากหยุดความเสียหาย จึงแสดงสถานะ
 * และมีปุ่มสลับด่วน (เรียก `PATCH /campaigns/{id}` ตัวเดียวกับกล่องแก้ไขกลุ่ม) ·
 * ปุ่มแสดงเฉพาะ Operation/SuperAdmin และเฉพาะตอน Rollout ยัง `active`/`paused` ·
 * ปิด = มีผลทันที (ยืนยันก่อน) เครื่องที่รอรอบใหม่จะจบด้วยผลรอบล่าสุดที่ poll ถัดไป
 */
export function RolloutAutoRetryControl({
  campaignId,
  rolloutStatus,
}: {
  campaignId: string;
  rolloutStatus: CampaignRolloutStatus;
}) {
  const { session } = useAuth();
  const campaignQuery = useCampaign(campaignId);
  const campaign = campaignQuery.data;
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!campaign) return null;

  const canToggle =
    canManageCampaign(session?.role) &&
    RETRY_RELEVANT_STATUSES.includes(rolloutStatus);

  async function setAutoRetry(next: boolean) {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      await updateCampaign(session.accessToken, campaignId, {
        autoRetry: next,
      });
      toast.success(
        next
          ? "เปิดการลองส่งใหม่อัตโนมัติแล้ว"
          : "ปิดการลองส่งใหม่อัตโนมัติแล้ว",
      );
      setConfirming(false);
      await campaignQuery.refetch();
    } catch (err) {
      setError(errorMessage(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <InfoRow label="ลองส่งใหม่อัตโนมัติ" icon={RefreshCwIcon}>
        <span className="flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-2">
            <span>{campaign.autoRetry ? "เปิด" : "ปิด"}</span>
            {canToggle && (
              <button
                type="button"
                role="switch"
                aria-checked={campaign.autoRetry}
                aria-label="ลองส่งใหม่อัตโนมัติ"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  if (campaign.autoRetry) setConfirming(true);
                  else void setAutoRetry(true);
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                  campaign.autoRetry ? "bg-primary" : "bg-input"
                }`}
              >
                <span
                  className={`block size-4 rounded-full bg-background shadow transition-transform ${
                    campaign.autoRetry
                      ? "translate-x-[1.125rem]"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            )}
          </span>
          {!confirming && error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
        </span>
      </InfoRow>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ปิดการลองส่งใหม่อัตโนมัติ?</AlertDialogTitle>
            <AlertDialogDescription>
              ถ้าปิด ระบบจะไม่ส่งซ้ำอีก
              เครื่องที่กำลังรอส่งซ้ำจะนับเป็นล้มเหลวทันที
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void setAutoRetry(false);
              }}
            >
              {saving ? "กำลังปิด…" : "ยืนยันปิด"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
