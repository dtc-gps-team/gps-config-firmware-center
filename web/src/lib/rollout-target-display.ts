import type {
  CampaignRolloutStatus,
  CampaignRolloutTarget,
} from "@/lib/campaign-api";

const TARGET_STATUS_LABEL: Record<string, string> = {
  pending: "รอผล",
  success: "สำเร็จ",
  failed: "ล้มเหลว",
  // เครื่องออฟไลน์ หรือคำสั่งถูกแทนที่/ยกเลิก: ไม่ใช่ความผิดของ Config จึงไม่นับเป็นล้มเหลว
  skipped_offline: "ข้าม (ออฟไลน์)",
};

/** สถานะที่ไม่รู้จักแสดงตามที่ backend ส่งมา ไม่ซ่อนและไม่เหมารวมเป็นล้มเหลว */
export function rolloutTargetStatusLabel(status: string): string {
  return TARGET_STATUS_LABEL[status] ?? status;
}

export type RolloutTargetSummary = {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  pending: number;
};

export function summarizeRolloutTargets(
  targets: Pick<CampaignRolloutTarget, "status">[],
): RolloutTargetSummary {
  const summary: RolloutTargetSummary = {
    total: targets.length,
    success: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
  };
  for (const t of targets) {
    if (t.status === "success") summary.success += 1;
    else if (t.status === "failed") summary.failed += 1;
    else if (t.status === "skipped_offline") summary.skipped += 1;
    else summary.pending += 1;
  }
  return summary;
}

/** Rollout ยังรอผลรายเครื่องอยู่หรือไม่ (ใช้เปิดรีเฟรชอัตโนมัติ หยุดเมื่อไม่มีอะไรให้รอ) */
export function isAwaitingTargetResults(
  rolloutStatus: CampaignRolloutStatus,
  targets: Pick<CampaignRolloutTarget, "status">[],
): boolean {
  if (rolloutStatus !== "active" && rolloutStatus !== "paused") return false;
  return targets.some((t) => t.status === "pending");
}
