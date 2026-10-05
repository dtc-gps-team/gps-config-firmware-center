"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import { canCreateCampaign, canDecideCampaignApproval } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
      toast.success("Resume แล้ว — status กลับเป็น active");
      onResumed(updated);
      // #238 review comment ข้อ 5 — เดิม reset เฉพาะใน catch ปกติแผงหายไปเอง
      // หลัง onResumed ทำให้ parent refetch/re-render (canResume กลาย false)
      // แต่ถ้า refetch ฝั่ง parent ช้าหรือพัง ปุ่มจะค้าง disabled อยู่ดี
      setResuming(false);
    } catch (err) {
      setResuming(false);
      const message = err instanceof ApiError ? err.message : "Resume ไม่สำเร็จ";
      setError(message);
      toast.error(message);
    }
  }

  async function handleRollback() {
    if (!session?.accessToken) return;
    if (successTargets.length > 0 && includedCount === 0) {
      setError("ต้องเหลืออุปกรณ์อย่างน้อย 1 เครื่องให้ rollback");
      return;
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
      toast.success("สร้าง Rollout สำหรับ Rollback แล้ว — รอ Operation อีกคนอนุมัติ");
      router.push(`/campaigns/${campaignId}/rollouts/${created.id}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError ? err.message : "สั่ง Rollback ไม่สำเร็จ";
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Card className="max-w-2xl gap-3 p-4">
      <p className="text-sm font-medium">Incident & Rollback</p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {canResume && !rollbackOpen && (
        <p className="text-sm text-muted-foreground">
          Rollout นี้หยุดอัตโนมัติเพราะ Failure Rate เกิน 5% — resume ให้ไปต่อ
          หรือสั่ง rollback กลับไปใช้ payload รอบก่อนหน้าแทน
        </p>
      )}

      {rollbackOpen ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            สั่ง Rollback — สร้าง Rollout ใหม่จาก payload ของรอบก่อนหน้าที่
            completed ล่าสุด เอาเครื่องที่ไม่ต้องการ rollback ออกได้
            ({includedCount}/{successTargets.length} เครื่อง)
          </p>

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
            <div className="max-h-56 overflow-y-auto rounded-lg border">
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
                        <TableCell className="font-mono text-xs">
                          {target.deviceId}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                submitting ||
                targetsLoading ||
                !!targetsError ||
                successTargets.length === 0
              }
              onClick={() => void handleRollback()}
            >
              {submitting ? "กำลังสร้าง Rollout…" : "ยืนยันสั่ง Rollback"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setRollbackOpen(false);
                setExcludedDeviceIds(new Set());
                setError(null);
              }}
            >
              ยกเลิก
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {canResume && (
            <Button
              size="sm"
              disabled={resuming}
              onClick={() => void handleResume()}
            >
              {resuming ? "กำลัง Resume…" : "Resume"}
            </Button>
          )}
          {canRollback && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRollbackOpen(true)}
            >
              สั่ง Rollback
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
