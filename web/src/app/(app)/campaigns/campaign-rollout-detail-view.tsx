"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ActivityIcon,
  CalendarCheckIcon,
  CalendarIcon,
  ClockIcon,
  PackageIcon,
  TargetIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  rolloutStatusLabel,
} from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useCampaignRollout } from "@/hooks/use-campaign-rollout";
import { useCampaignRolloutTargets } from "@/hooks/use-campaign-rollout-targets";
import { useConfig } from "@/hooks/use-config";
import { useFirmware } from "@/hooks/use-firmware";
import { usePollInterval } from "@/hooks/use-poll-interval";
import { useAutoRetryMaxAttempts } from "@/hooks/use-auto-retry-max-attempts";
import {
  isAwaitingTargetResults,
  rolloutTargetStatusLabel,
  summarizeRolloutTargets,
} from "@/lib/rollout-target-display";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { ErrorState } from "@/components/error-state";
import { RefreshControl } from "@/components/refresh-control";
import { ChangeFlash } from "@/components/motion/change-flash";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { PageHeader } from "@/components/page-header";
import { RoleGuard } from "@/components/auth/role-guard";
import { canReadCampaign } from "@/lib/permissions";
import { CampaignRolloutApprovalPanel } from "./campaign-rollout-approval-panel";
import { CampaignRolloutReleasePanel } from "./campaign-rollout-release-panel";
import { CampaignRolloutIncidentPanel } from "./campaign-rollout-incident-panel";
import { RolloutProgressCard } from "./rollout-progress-card";
import { RolloutAutoRetryControl } from "./rollout-auto-retry-control";
import { RolloutTargetRow } from "./rollout-target-row";
import {
  countRetryingTargets,
  filterTargetsByRetry,
  isTargetRetryExhausted,
  type TargetRetryFilter,
} from "@/lib/rollout-retry-display";

/**
 * รายละเอียด Rollout 1 รอบ — ต่อ `GET /campaigns/{id}/rollouts/{rolloutId}`
 * + `GET .../targets` จริง (Campaign Monitor #22, แก้ไข 2026-09-24) — แสดง
 * ผล success/failure ต่อเครื่องจริง (ปิด gap เดิมที่ `successCount`/
 * `failureCount` เป็น 0 เสมอ)
 */
/** ระหว่างรอผลรายเครื่อง รีเฟรชทุก 5 วินาที (ผลจากกล่องมาทีหลังกดปล่อยหลายวินาที) */
const RESULT_POLL_INTERVAL_MS = 5_000;

/** กันทั้งหน้าด้วย `RoleGuard` แบบเดียวกับหน้า Campaign (FirmwareEngineer/
 * QAEngineer ไม่มีสิทธิ์ `campaign:Read`) · เดิมไม่มีตัวกัน role เหล่านี้กดลิงก์
 * จากการ์ด "ผลกระทบ" ในหน้า Incident เข้ามาแล้วเจอข้อความ 403 ดิบจาก backend ·
 * ใส่ตัวกันไว้ชั้นนอก hook ข้างในจึงไม่ยิง API เลยถ้าไม่มีสิทธิ์ */
export function CampaignRolloutDetailView(props: {
  campaignId: string;
  rolloutId: string;
}) {
  return (
    <RoleGuard allow={canReadCampaign}>
      <RolloutDetailContent {...props} />
    </RoleGuard>
  );
}

function RolloutDetailContent({
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
  const maxAttempts = useAutoRetryMaxAttempts();
  const [retryFilter, setRetryFilter] = useState<TargetRetryFilter>("all");
  // resolve ชื่อ Config/Firmware เอง (backend ไม่ embed) — pattern เดียวกับ
  // campaign-detail-view.tsx เดิม
  const configQuery = useConfig(data?.configId ?? null);
  const firmwareQuery = useFirmware(data?.firmwareId ?? null);

  // รีเฟรชทั้ง Rollout (สถานะอาจเปลี่ยนเป็น completed/paused เอง) และผลรายเครื่อง
  // เฉพาะตอนยังมีเครื่องรอผลอยู่ · หยุดเองเมื่อไม่มีอะไรให้รอ
  const awaitingResults = data
    ? isAwaitingTargetResults(data.status, targetsQuery.data ?? [])
    : false;
  usePollInterval(() => {
    if (!awaitingResults) return;
    void refetch();
    void targetsQuery.refetch();
  }, RESULT_POLL_INTERVAL_MS);

  if (isLoading && !data) {
    return <DetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          message={error ?? "ไม่พบ Rollout นี้"}
          onRetry={() => void refetch()}
        />
        <Link
          href={`/campaigns/${campaignId}`}
          className={
            buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"
          }
        >
          กลับไปหน้ากลุ่ม
        </Link>
      </div>
    );
  }

  const targets = targetsQuery.data ?? [];
  const summary = summarizeRolloutTargets(targets);
  const retryingCount = countRetryingTargets(targets);
  const exhaustedCount = targets.filter((t) =>
    isTargetRetryExhausted(t, maxAttempts),
  ).length;
  const shownTargets = filterTargetsByRetry(targets, retryFilter, maxAttempts);
  // ตัวกรองแสดงเฉพาะเมื่อมีเครื่องที่ลองส่งใหม่ (หรือกำลังกรองอยู่ จะได้กลับมาเลือก "ทั้งหมด" ได้เสมอ)
  const showRetryFilter =
    retryingCount > 0 || exhaustedCount > 0 || retryFilter !== "all";
  const retryFilterOptions: { value: TargetRetryFilter; label: string }[] = [
    { value: "all", label: "ทั้งหมด" },
    { value: "retrying", label: `รอส่งรอบใหม่ (${retryingCount})` },
    { value: "exhausted", label: `ส่งครบทุกรอบไม่สำเร็จ (${exhaustedCount})` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Rollout: ${data.payloadType}`}
        breadcrumb={[
          { label: "กลุ่มอุปกรณ์", href: `/campaigns/${campaignId}` },
          { label: `Rollout: ${data.payloadType}` },
        ]}
        status={
          <StatusPill
            tone={CAMPAIGN_ROLLOUT_STATUS_TONE[data.status] ?? "neutral"}
          >
            {rolloutStatusLabel(data.status)}
          </StatusPill>
        }
        description={getRolloutStatusExplanation(data.status)}
        actions={
          <>
            <RefreshControl />
            <CampaignRolloutIncidentPanel
              showPausedNotice={false}
              campaignId={campaignId}
              rollout={data}
              targets={targets}
              targetsLoading={targetsQuery.isLoading && !targetsQuery.data}
              targetsError={targetsQuery.error}
              onResumed={() => void refetch()}
            />
          </>
        }
      />

      {/* สองคอลัมน์บนจอกว้าง: งานหลัก (อนุมัติ ปล่อย ความคืบหน้า ผลต่อเครื่อง) ทางซ้าย
       * ข้อมูลสรุปของ Rollout ทางขวา · การ์ดในคอลัมน์ซ้ายยืดเต็มความกว้างของคอลัมน์
       * (ปิด max-w ของแต่ละแผง) ขอบขวาจึงเสมอกัน ไม่เหลื่อมเป็นขั้นบันได */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6 [&>*]:max-w-none">
          <CampaignRolloutApprovalPanel
            campaignId={campaignId}
            rollout={data}
            onDecided={() => void refetch()}
          />

          <CampaignRolloutReleasePanel
            campaignId={campaignId}
            rollout={data}
            onReleased={() => void refetch()}
            onRejected={() => void refetch()}
          />

          {/* แถบความคืบหน้าหลังกดปล่อย: ก่อนปล่อยทุกเครื่องยังไม่มีผล จึงยังไม่แสดง */}
          {(data.status === "active" ||
            data.status === "paused" ||
            data.status === "completed") &&
            summary.total > 0 && (
              <RolloutProgressCard
                status={data.status}
                payloadType={data.payloadType}
                summary={summary}
                awaiting={awaitingResults}
                retrying={retryingCount}
              />
            )}
          <Card className="gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                ผลต่อเครื่อง (
                {retryFilter === "all"
                  ? targets.length
                  : `${shownTargets.length} จาก ${targets.length}`}
                )
              </p>
              {awaitingResults && (
                <span className="text-xs text-muted-foreground">
                  กำลังรอผลจากกล่อง รีเฟรชอัตโนมัติทุก 5 วินาที
                </span>
              )}
            </div>
            {showRetryFilter && (
              <div
                role="group"
                aria-label="กรองผลต่อเครื่อง"
                className="flex flex-wrap gap-2"
              >
                {retryFilterOptions.map((o) => (
                  <Button
                    key={o.value}
                    type="button"
                    size="sm"
                    variant={retryFilter === o.value ? "default" : "outline"}
                    aria-pressed={retryFilter === o.value}
                    onClick={() => setRetryFilter(o.value)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
            {targetsQuery.isLoading && !targetsQuery.data ? (
              <TableSkeleton columns={4} rows={4} />
            ) : targetsQuery.error ? (
              <ErrorState
                message={targetsQuery.error}
                onRetry={() => void targetsQuery.refetch()}
              />
            ) : targets.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                ยังไม่มีเป้าหมายในรอบนี้
              </p>
            ) : shownTargets.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                ไม่มีเครื่องในตัวกรองนี้
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
                    {shownTargets.map((target) => (
                      <RolloutTargetRow
                        key={target.id}
                        campaignId={campaignId}
                        rolloutId={rolloutId}
                        target={target}
                        maxAttempts={maxAttempts}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6">
          <Card className="p-4">
            <div className="divide-y">
              <InfoRow label="Payload" icon={PackageIcon}>
                {data.payloadType === "Config"
                  ? (configQuery.data?.name ?? data.configId ?? "-")
                  : firmwareQuery.data
                    ? `v${firmwareQuery.data.version}`
                    : (data.firmwareId ?? "-")}
              </InfoRow>
              <InfoRow label="จำนวนเป้าหมาย" icon={TargetIcon}>
                {data.targetCount}
              </InfoRow>
              <InfoRow label="สำเร็จ / ล้มเหลว" icon={ActivityIcon}>
                <span className="text-success-foreground">
                  {data.successCount}
                </span>{" "}
                /{" "}
                <span className="text-danger-foreground">
                  {data.failureCount}
                </span>
              </InfoRow>
              <RolloutAutoRetryControl
                campaignId={campaignId}
                rolloutStatus={data.status}
              />
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
          </Card>
        </aside>
      </div>
    </div>
  );
}
