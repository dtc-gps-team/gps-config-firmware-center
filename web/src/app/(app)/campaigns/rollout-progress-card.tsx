"use client";

import { Card } from "@/components/ui/card";
import { CountUp } from "@/components/motion/count-up";
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
  embedded = false,
}: {
  status: CampaignRolloutStatus;
  payloadType: string;
  summary: RolloutTargetSummary;
  awaiting: boolean;
  /** วางในการ์ดอื่นอยู่แล้ว: ไม่วาดกรอบและพื้นซ้อน */
  embedded?: boolean;
}) {
  const { done, total, percent } = rolloutProgress(summary);
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <Card
      className={embedded ? "gap-3 bg-transparent p-0 ring-0" : "gap-3 p-5"}
      data-testid="rollout-progress"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium">
          {headline(status, payloadType, total, awaiting)}
        </p>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">
            <CountUp value={percent} suffix="%" /> ได้ผลแล้ว
          </p>
          <p className="font-instrument text-xs text-muted-foreground">
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
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
      >
        <div
          className="h-full rounded-full bg-success transition-[width] duration-(--duration-slow) ease-(--ease-standard)"
          style={{ width: `${pct(summary.success)}%` }}
        />
        <div
          className="h-full rounded-full bg-warning transition-[width] duration-(--duration-slow) ease-(--ease-standard)"
          style={{ width: `${pct(summary.skipped)}%` }}
        />
        <div
          className="h-full rounded-full bg-destructive transition-[width] duration-(--duration-slow) ease-(--ease-standard)"
          style={{ width: `${pct(summary.failed)}%` }}
        />
        {/* ส่วนที่ยังรอผล: เทาลายเฉียงตรงกับจุดสีในคำอธิบาย กะพริบเบาๆ ขณะยังรออยู่ */}
        {summary.pending > 0 && (
          <div
            className={`h-full rounded-full bg-muted-foreground/25 ${awaiting ? "animate-pulse" : ""}`}
            style={{ width: `${pct(summary.pending)}%` }}
          />
        )}
      </div>

      <div className="font-instrument flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" />
          สำเร็จ {summary.success}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-warning" />
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
