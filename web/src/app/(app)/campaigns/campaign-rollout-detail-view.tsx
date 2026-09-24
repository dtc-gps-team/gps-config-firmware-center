"use client";

import Link from "next/link";
import {
  ActivityIcon,
  CalendarCheckIcon,
  CalendarIcon,
  ClockIcon,
  PackageIcon,
  TargetIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CAMPAIGN_ROLLOUT_STATUS_TONE,
  CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE,
  StatusPill,
  getRolloutStatusExplanation,
  statusLabel,
} from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useCampaignRollout } from "@/hooks/use-campaign-rollout";
import { useCampaignRolloutTargets } from "@/hooks/use-campaign-rollout-targets";
import { useConfig } from "@/hooks/use-config";
import { useFirmware } from "@/hooks/use-firmware";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { CampaignRolloutApprovalPanel } from "./campaign-rollout-approval-panel";

/**
 * รายละเอียด Rollout 1 รอบ — ต่อ `GET /campaigns/{id}/rollouts/{rolloutId}`
 * + `GET .../targets` จริง (Campaign Monitor #22, แก้ไข 2026-09-24) — แสดง
 * ผล success/failure ต่อเครื่องจริง (ปิด gap เดิมที่ `successCount`/
 * `failureCount` เป็น 0 เสมอ)
 */
export function CampaignRolloutDetailView({
  campaignId,
  rolloutId,
}: {
  campaignId: string;
  rolloutId: string;
}) {
  const { data, isLoading, error, refetch } = useCampaignRollout(
    campaignId,
    rolloutId,
  );
  const targetsQuery = useCampaignRolloutTargets(campaignId, rolloutId);
  // resolve ชื่อ Config/Firmware เอง (backend ไม่ embed) — pattern เดียวกับ
  // campaign-detail-view.tsx เดิม
  const configQuery = useConfig(data?.configId ?? null);
  const firmwareQuery = useFirmware(data?.firmwareId ?? null);

  if (isLoading && !data) {
    return <DetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{error ?? "ไม่พบ Rollout นี้"}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href={`/campaigns/${campaignId}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปหน้ากลุ่ม
          </Link>
        </div>
      </div>
    );
  }

  const targets = targetsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปหน้ากลุ่ม
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Rollout — {data.payloadType}</h1>
          <StatusPill tone={CAMPAIGN_ROLLOUT_STATUS_TONE[data.status]}>
            {statusLabel(data.status)}
          </StatusPill>
        </div>
        <p className="text-sm text-muted-foreground">
          {getRolloutStatusExplanation(data.status)}
        </p>
      </div>

      <CampaignRolloutApprovalPanel
        campaignId={campaignId}
        rollout={data}
        onDecided={() => void refetch()}
      />

      <div className="max-w-xl rounded-xl border bg-card p-4">
        <div className="divide-y">
          <InfoRow label="Payload" icon={PackageIcon}>
            {data.payloadType === "Config"
              ? (configQuery.data?.name ?? data.configId ?? "—")
              : firmwareQuery.data
                ? `v${firmwareQuery.data.version}`
                : (data.firmwareId ?? "—")}
          </InfoRow>
          <InfoRow label="จำนวนเป้าหมาย" icon={TargetIcon}>
            {data.targetCount}
          </InfoRow>
          <InfoRow label="สำเร็จ / ล้มเหลว" icon={ActivityIcon}>
            {data.successCount} / {data.failureCount}
          </InfoRow>
          {data.approvedAt && (
            <InfoRow label="อนุมัติเมื่อ" icon={CalendarCheckIcon}>
              {formatDateTime(data.approvedAt)}
            </InfoRow>
          )}
          <InfoRow label="สร้างเมื่อ" icon={CalendarIcon}>
            {formatDateTime(data.createdAt)}
          </InfoRow>
          <InfoRow label="แก้ไขล่าสุด" icon={ClockIcon}>
            {formatDateTime(data.updatedAt)}
          </InfoRow>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <p className="text-sm font-medium">ผลต่อเครื่อง ({targets.length})</p>
        {targetsQuery.isLoading && !targetsQuery.data ? (
          <p className="py-4 text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : targetsQuery.error ? (
          <p className="py-4 text-sm text-destructive">{targetsQuery.error}</p>
        ) : targets.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            ยังไม่มีเป้าหมายในรอบนี้
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>เลขเครื่อง</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>รายละเอียดผล</TableHead>
                  <TableHead className="text-right">อัปเดตล่าสุด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="font-mono text-xs">
                      {target.deviceId}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        tone={
                          CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE[target.status] ??
                          "neutral"
                        }
                      >
                        {target.status === "pending"
                          ? "ยังไม่มีผล"
                          : target.status === "success"
                            ? "สำเร็จ"
                            : "ล้มเหลว"}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {target.resultDetail ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-right text-muted-foreground"
                      title={formatDateTime(target.updatedAt)}
                    >
                      {formatRelativeTime(target.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
