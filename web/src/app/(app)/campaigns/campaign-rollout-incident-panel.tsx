"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlayIcon, Undo2Icon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  resumeCampaignRollout,
  rollbackCampaignRollout,
  RESUMABLE_CAMPAIGN_ROLLOUT_STATUS,
  ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES,
  type CampaignRollout,
  type CampaignRolloutTarget,
} from "@/lib/campaign-api";
import {
  canCreateCampaign,
  canDecideCampaignApproval,
} from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * แผง "Resume" / "สั่ง Rollback" — Incident & Rollback (#28) mirror
 * GPS_Config_Firmware_Center_Design.pdf §12.2: "Campaign Monitor" มี
 * Pause/Resume/Rollback ในตัว (ไม่ใช่ Incident Center ซึ่งเป็นคนละเรื่อง —
 * Suspend Firmware/Hotfix Campaign/Root Cause ระดับ Firmware ทั้งเวอร์ชัน) —
 * ใช้ร่วมกัน 2 ที่: `campaign-detail-view.tsx` (Campaign Monitor — โผล่ให้
 * Rollout ล่าสุดของกลุ่มทันที ไม่ต้องคลิกเข้า Rollout Detail ก่อน) และ
 * `campaign-rollout-detail-view.tsx` (Rollout Detail — ดูรอบที่ไม่ใช่รอบ
 * ล่าสุดของกลุ่มได้ตรงๆ) โผล่เฉพาะสถานะที่ทำได้จริง (ดู
 * `RESUMABLE_CAMPAIGN_ROLLOUT_STATUS`/`ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES`
 * — mirror เงื่อนไขฝั่ง backend เป๊ะ) แยกจาก `CampaignRolloutApprovalPanel`
 * เพราะคนละสถานะกันเสมอ (approval panel โผล่แค่ `pending_approval` อันนี้
 * โผล่แค่ `active`/`paused`/`completed`) ไม่มีทางซ้อนกันในหน้าเดียว
 *
 * - **Resume**: `paused` → `active` เท่านั้น ไม่เช็ค Separation of Duty
 *   (ผู้สร้าง Rollout เองก็กดได้ — mirror backend)
 * - **Rollback**: สร้าง Rollout ใหม่จาก payload ของรอบก่อนหน้าที่ completed
 *   ล่าสุด — target = เฉพาะเครื่องที่ได้รับ payload ของรอบนี้สำเร็จจริง
 *   (`CampaignRolloutTarget.status = success`) เอาบางเครื่องออกได้ผ่าน
 *   `excludeDeviceIds` (mirror ตารางเลือกเครื่องของ
 *   `CampaignRolloutCreateForm`) — สำเร็จแล้ว**คืน Rollout ใหม่** ต้องพา
 *   ผู้ใช้ไปหน้ารายละเอียดของรอบใหม่ทันที ไม่ใช่ refetch รอบเดิม
 */
export function CampaignRolloutIncidentPanel({
  campaignId,
  rollout,
  targets,
  targetsLoading = false,
  targetsError = null,
  showPausedNotice = true,
  onResumed,
}: {
  campaignId: string;
  rollout: CampaignRollout;
  targets: CampaignRolloutTarget[];
  /** #238 review comment ข้อ 5 — เดิม parent ส่ง `data ?? []` มาตรงๆ ทำให้
   * แยกไม่ออกระหว่าง "ยังโหลดอยู่" กับ "โหลดเสร็จแล้วแต่ไม่มีเครื่องสำเร็จ
   * เลยจริงๆ" (ทั้งคู่ได้ `[]` เหมือนกัน) เพิ่ม 2 prop นี้ให้ panel แยกแสดงผล
   * ถูกต้องระหว่างเปิดแผง Rollback — ไม่บังคับใส่ (default โหลดเสร็จ/ไม่มี
   * error) กันพังของเก่าที่ยังไม่ได้ส่งมา */
  targetsLoading?: boolean;
  targetsError?: string | null;
  /** แสดงคำอธิบายว่าหยุดอัตโนมัติเพราะอะไรเหนือปุ่ม (ค่าเริ่มต้นแสดง) · หน้า Rollout Detail
   * ปิดไว้เพราะหัวหน้าอธิบายสถานะ paused อยู่แล้ว และวางปุ่มไว้มุมขวาบนของหัวหน้า */
  showPausedNotice?: boolean;
  onResumed: (updated: CampaignRollout) => void;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const role = session?.role;

  const [resuming, setResuming] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [excludedDeviceIds, setExcludedDeviceIds] = useState<Set<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canResume =
    rollout.status === RESUMABLE_CAMPAIGN_ROLLOUT_STATUS &&
    canDecideCampaignApproval(role);
  const canRollback =
    ROLLBACKABLE_CAMPAIGN_ROLLOUT_STATUSES.includes(rollout.status) &&
    canCreateCampaign(role);

  if (!canResume && !canRollback) {
    return null;
  }

  const successTargets = targets.filter((t) => t.status === "success");
  const includedCount = successTargets.length - excludedDeviceIds.size;

  function toggleExcluded(deviceId: string, included: boolean) {
    setExcludedDeviceIds((prev) => {
      const next = new Set(prev);
      if (included) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
    setError(null);
  }

  async function handleResume() {
    if (!session?.accessToken) return;
    setResuming(true);
    setError(null);
    try {
      const updated = await resumeCampaignRollout(
        session.accessToken,
        campaignId,
        rollout.id,
      );
      toast.success("Resume แล้ว status กลับเป็น active");
      onResumed(updated);
      // #238 review comment ข้อ 5 — เดิม reset เฉพาะใน catch ปกติแผงหายไปเอง
      // หลัง onResumed ทำให้ parent refetch/re-render (canResume กลาย false)
      // แต่ถ้า refetch ฝั่ง parent ช้าหรือพัง ปุ่มจะค้าง disabled อยู่ดี
      setResuming(false);
    } catch (err) {
      setResuming(false);
      const message =
        err instanceof ApiError ? err.message : "Resume ไม่สำเร็จ";
      setError(message);
      toast.error(message);
    }
  }

  async function handleRollback(): Promise<boolean> {
    if (!session?.accessToken) return false;
    if (successTargets.length > 0 && includedCount === 0) {
      setError("ต้องเหลืออุปกรณ์อย่างน้อย 1 เครื่องให้ rollback");
      return false;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await rollbackCampaignRollout(
        session.accessToken,
        campaignId,
        rollout.id,
        excludedDeviceIds.size > 0
          ? { excludeDeviceIds: [...excludedDeviceIds] }
          : {},
      );
      toast.success(
        "สร้าง Rollout สำหรับ Rollback แล้ว รอ Operation อีกคนอนุมัติ",
      );
      router.push(`/campaigns/${campaignId}/rollouts/${created.id}`);
      router.refresh();
      return true;
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError ? err.message : "สั่ง Rollback ไม่สำเร็จ";
      setError(message);
      toast.error(message);
      return false;
    }
  }

  function closeRollback() {
    setRollbackOpen(false);
    setExcludedDeviceIds(new Set());
    setError(null);
  }

  return (
    <>
      <div className="flex flex-col items-end gap-2">
        {canResume && showPausedNotice && (
          <p className="text-sm text-muted-foreground">
            Rollout นี้หยุดอัตโนมัติเพราะ Failure Rate เกิน 5% กด Resume
            เพื่อไปต่อ หรือสั่ง Rollback กลับไปใช้ค่าของรอบก่อนหน้า
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canRollback && (
            // Rollback เป็นการกระทำเสี่ยง: ใช้สีแดงอ่อน (destructive) ไม่ใช่ปุ่มทึบ
            // และให้ Resume เป็นปุ่มหลัก (วางท้ายสุดตามแบบของ PageHeader)
            <Button variant="destructive" onClick={() => setRollbackOpen(true)}>
              <Undo2Icon />
              สั่ง Rollback
            </Button>
          )}
          {canResume && (
            <Button disabled={resuming} onClick={() => void handleResume()}>
              <PlayIcon />
              {resuming ? "กำลัง Resume…" : "Resume"}
            </Button>
          )}
        </div>
        {error && !rollbackOpen && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>

      <ConfirmDialog
        open={rollbackOpen}
        onOpenChange={(open) => {
          if (open) setRollbackOpen(true);
          else if (!submitting) closeRollback();
        }}
        title="สั่ง Rollback"
        description={
          <>
            สร้าง Rollout ใหม่จาก payload ของรอบก่อนหน้าที่ completed ล่าสุด
            {successTargets.length > 0 && (
              <>
                {" "}
                จะส่งกลับให้{" "}
                <strong className="tabular-nums">
                  {includedCount} จาก {successTargets.length} เครื่อง
                </strong>{" "}
                ที่ได้รับ payload รอบนี้สำเร็จ
              </>
            )}
          </>
        }
        confirmLabel="ยืนยันสั่ง Rollback"
        destructive
        confirmDisabled={
          targetsLoading ||
          !!targetsError ||
          successTargets.length === 0 ||
          includedCount === 0
        }
        onConfirm={handleRollback}
      >
        {targetsLoading ? (
          <p className="text-sm text-muted-foreground">
            กำลังโหลดรายชื่อเครื่อง…
          </p>
        ) : targetsError ? (
          <p className="text-sm text-destructive">{targetsError}</p>
        ) : successTargets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีเครื่องที่ได้รับ payload ของรอบนี้สำเร็จเลย
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10"></TableHead>
                  <TableHead>เลขเครื่อง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {successTargets.map((target) => {
                  const included = !excludedDeviceIds.has(target.deviceId);
                  return (
                    <TableRow key={target.id}>
                      <TableCell>
                        <Checkbox
                          checked={included}
                          onCheckedChange={(c) =>
                            toggleExcluded(target.deviceId, c === true)
                          }
                          aria-label={
                            included
                              ? "เอาเครื่องนี้ออกจาก Rollback"
                              : "เอาเครื่องนี้กลับเข้า Rollback"
                          }
                        />
                      </TableCell>
                      <TableCell className="font-instrument text-xs">
                        {target.deviceId}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
