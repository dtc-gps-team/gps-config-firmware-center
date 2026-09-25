"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarIcon,
  ClockIcon,
  HardDriveIcon,
  RocketIcon,
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
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useAuth } from "@/components/auth/auth-provider";
import { useCampaign } from "@/hooks/use-campaign";
import { useCampaignTargets } from "@/hooks/use-campaign-targets";
import { useCampaignRollouts } from "@/hooks/use-campaign-rollouts";
import { OPEN_CAMPAIGN_ROLLOUT_STATUSES } from "@/lib/campaign-api";
import { canCreateCampaign } from "@/lib/permissions";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { EmptyState } from "@/components/empty-state";

/**
 * รายละเอียดกลุ่มอุปกรณ์ 1 กลุ่ม — ต่อ `GET /campaigns/{id}` +
 * `GET /campaigns/{id}/targets` + `GET /campaigns/{id}/rollouts` จริง
 * (Campaign Monitor #22, แก้ไข 2026-09-24)
 *
 * เดิมหน้านี้แสดง payload/status/successCount ของ Campaign ตรงๆ (ผูก payload
 * ตัวเดียว) — ตอนนี้ Campaign เป็นแค่กลุ่ม ไม่มี payload/status เอง จึงแสดง
 * สมาชิกกลุ่ม + ประวัติ Rollout ที่ push เข้ากลุ่มนี้แทน (คลิกแต่ละ Rollout
 * เพื่อดูผล per-target/failure rate จริง)
 */
export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const { data, isLoading, error, refetch } = useCampaign(campaignId);
  const targetsQuery = useCampaignTargets(campaignId);
  const rolloutsQuery = useCampaignRollouts(campaignId);

  if (isLoading && !data) {
    return <DetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{error ?? "ไม่พบกลุ่มนี้"}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href="/campaigns"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปรายการ
          </Link>
        </div>
      </div>
    );
  }

  const rollouts = rolloutsQuery.data ?? [];
  const hasOpenRollout = rollouts.some((r) =>
    (OPEN_CAMPAIGN_ROLLOUT_STATUSES as readonly string[]).includes(r.status),
  );
  const canStartRollout = canCreateCampaign(session?.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/campaigns"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← กลับไปรายการแคมเปญ
        </Link>
        <h1 className="text-2xl font-semibold break-words">{data.name}</h1>
        {data.description && (
          <p className="text-sm text-muted-foreground">{data.description}</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            สมาชิกกลุ่ม ({(targetsQuery.data ?? []).length})
          </p>
        </div>
        {targetsQuery.isLoading && !targetsQuery.data ? (
          <p className="py-4 text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : targetsQuery.error ? (
          <p className="py-4 text-sm text-destructive">{targetsQuery.error}</p>
        ) : (targetsQuery.data ?? []).length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            กลุ่มนี้ยังไม่มีสมาชิก
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>เลขเครื่อง</TableHead>
                  <TableHead className="text-right">เพิ่มเข้ากลุ่มเมื่อ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(targetsQuery.data ?? []).map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="font-mono text-xs">
                      {target.deviceId}
                    </TableCell>
                    <TableCell
                      className="text-right text-muted-foreground"
                      title={formatDateTime(target.createdAt)}
                    >
                      {formatRelativeTime(target.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">ประวัติ Rollout</p>
          {canStartRollout && (
            <Link
              href={
                hasOpenRollout
                  ? "#"
                  : `/campaigns/${campaignId}/rollouts/new`
              }
              aria-disabled={hasOpenRollout}
              className={buttonVariants({
                size: "sm",
                variant: hasOpenRollout ? "outline" : "default",
                className: hasOpenRollout
                  ? "pointer-events-none opacity-50"
                  : undefined,
              })}
            >
              <RocketIcon /> Roll out ใหม่
            </Link>
          )}
        </div>
        {hasOpenRollout && (
          <p className="text-xs text-muted-foreground">
            กลุ่มนี้มี Rollout ที่ยังไม่จบอยู่แล้ว — ต้องรอให้จบก่อน
            (completed/rejected/cancelled) ถึงจะเริ่มรอบใหม่ได้
          </p>
        )}

        {rolloutsQuery.isLoading && !rolloutsQuery.data ? (
          <p className="py-4 text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : rolloutsQuery.error ? (
          <p className="py-4 text-sm text-destructive">
            {rolloutsQuery.error}
          </p>
        ) : rollouts.length === 0 ? (
          <EmptyState
            icon={HardDriveIcon}
            message="กลุ่มนี้ยังไม่เคย Roll out payload เลย"
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>สถานะ</TableHead>
                  <TableHead>Payload</TableHead>
                  <TableHead className="text-right">สำเร็จ / ล้มเหลว</TableHead>
                  <TableHead className="text-right">สร้างเมื่อ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rollouts.map((rollout) => (
                  <TableRow
                    key={rollout.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(
                        `/campaigns/${campaignId}/rollouts/${rollout.id}`,
                      )
                    }
                  >
                    <TableCell>
                      <StatusPill
                        tone={
                          CAMPAIGN_ROLLOUT_STATUS_TONE[rollout.status] ??
                          "neutral"
                        }
                      >
                        {statusLabel(rollout.status)}
                      </StatusPill>
                    </TableCell>
                    <TableCell>{rollout.payloadType}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {rollout.successCount} / {rollout.failureCount} /{" "}
                      {rollout.targetCount}
                    </TableCell>
                    <TableCell
                      className="text-right text-muted-foreground"
                      title={formatDateTime(rollout.createdAt)}
                    >
                      {formatRelativeTime(rollout.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="max-w-md rounded-xl border bg-card p-4">
        <div className="divide-y">
          <div className="flex justify-between gap-4 py-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarIcon className="size-3.5" /> สร้างเมื่อ
            </span>
            <span>{formatDateTime(data.createdAt)}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ClockIcon className="size-3.5" /> แก้ไขล่าสุด
            </span>
            <span>{formatDateTime(data.updatedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
