"use client";

import { Card } from "@/components/ui/card";
import type { CampaignRolloutStatus } from "@/lib/campaign-api";
import {
  rolloutProgress,
  type RolloutTargetSummary,
} from "@/lib/rollout-target-display";

function headline(
  status: CampaignRolloutStatus,
  payloadType: string,
  total: number,
  awaiting: boolean,
): string {
  if (status === "paused") {
    return `หยุดชั่วคราว การส่ง ${payloadType} ให้ ${total} เครื่อง`;
  }
  if (awaiting) return `กำลังส่ง ${payloadType} ให้ ${total} เครื่อง`;
  return `ส่ง ${payloadType} ให้ ${total} เครื่องเสร็จสิ้น`;
}

/**
 * แถบความคืบหน้าของ Rollout หลังกดปล่อย (หน้ารายละเอียด Rollout) — แถบเดียวแบ่งสีตาม
 * ผลของแต่ละเครื่อง: เขียว = สำเร็จ, ฟ้า = ข้าม (ออฟไลน์), แดง = ล้มเหลว, ส่วนที่ยังว่าง
 * = รอผล (กะพริบเบาๆ ขณะยังรออยู่) · เปอร์เซ็นต์นับทุกเครื่องที่ "ได้ผลแล้ว" ไม่ว่าผลเป็นอย่างไร
 * · ข้อมูลมาจากผลรายเครื่องที่รีเฟรชอัตโนมัติอยู่แล้ว จึงขยับเองโดยไม่ต้องกดรีเฟรช
 */
export function RolloutProgressCard({
  status,
  payloadType,
  summary,
  awaiting,
}: {
  status: CampaignRolloutStatus;
  payloadType: string;
  summary: RolloutTargetSummary;
  awaiting: boolean;
}) {
  const { done, total, percent } = rolloutProgress(summary);
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <Card className="gap-3 p-5" data-testid="rollout-progress">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium">
          {headline(status, payloadType, total, awaiting)}
        </p>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold">{percent}% ได้ผลแล้ว</p>
          <p className="text-xs text-muted-foreground">
            {done} / {total} เครื่อง
          </p>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="ความคืบหน้าของ Rollout"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-success transition-[width] duration-500"
          style={{ width: `${pct(summary.success)}%` }}
        />
        <div
          className="h-full bg-info transition-[width] duration-500"
          style={{ width: `${pct(summary.skipped)}%` }}
        />
        <div
          className="h-full bg-destructive transition-[width] duration-500"
          style={{ width: `${pct(summary.failed)}%` }}
        />
        {awaiting && summary.pending > 0 && (
          <div
            className="h-full animate-pulse bg-primary/30"
            style={{ width: `${pct(summary.pending)}%` }}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" />
          สำเร็จ {summary.success}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-info" />
          ข้าม {summary.skipped}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-destructive" />
          ล้มเหลว {summary.failed}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/40" />
          รอผล {summary.pending}
        </span>
      </div>
    </Card>
  );
}
