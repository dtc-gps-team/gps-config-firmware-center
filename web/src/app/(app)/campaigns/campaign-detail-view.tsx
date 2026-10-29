"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { HardDriveIcon, RocketIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
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
  StatusPill,
  getRolloutStatusExplanation,
  rolloutStatusLabel,
} from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { useAuth } from "@/components/auth/auth-provider";
import { RoleGuard } from "@/components/auth/role-guard";
import { useCampaign } from "@/hooks/use-campaign";
import { useCampaignTargets } from "@/hooks/use-campaign-targets";
import { useCampaignRollouts } from "@/hooks/use-campaign-rollouts";
import { useCampaignRolloutTargets } from "@/hooks/use-campaign-rollout-targets";
import { OPEN_CAMPAIGN_ROLLOUT_STATUSES } from "@/lib/campaign-api";
import { canCreateCampaign, canReadCampaign } from "@/lib/permissions";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { RefreshControl } from "@/components/refresh-control";
import { TableSkeleton } from "@/components/skeleton/table-skeleton";
import { PageHeader, PageHeaderMeta } from "@/components/page-header";
import { UrlTabs } from "@/components/url-tabs";
import { DisabledWithReason } from "@/components/disabled-with-reason";
import { RolloutProgressCard } from "./rollout-progress-card";
import {
  isAwaitingTargetResults,
  summarizeRolloutTargets,
} from "@/lib/rollout-target-display";
import { DeviceHistorySheet } from "../devices/device-history-sheet";
import { CampaignRolloutApprovalPanel } from "./campaign-rollout-approval-panel";
import { CampaignRolloutReleasePanel } from "./campaign-rollout-release-panel";
import { CampaignRolloutIncidentPanel } from "./campaign-rollout-incident-panel";

/**
 * รายละเอียดกลุ่มอุปกรณ์ 1 กลุ่ม — ต่อ `GET /campaigns/{id}` +
 * `GET /campaigns/{id}/targets` + `GET /campaigns/{id}/rollouts` จริง
 * (Campaign Monitor #22, แก้ไข 2026-09-24)
 *
 * เดิมหน้านี้แสดง payload/status/successCount ของ Campaign ตรงๆ (ผูก payload
 * ตัวเดียว) — ตอนนี้ Campaign เป็นแค่กลุ่ม ไม่มี payload/status เอง จึงแสดง
 * สมาชิกกลุ่ม + ประวัติ Rollout ที่ push เข้ากลุ่มนี้แทน (คลิกแต่ละ Rollout
 * เพื่อดูผล per-target/failure rate จริง)
 *
 * `RoleGuard` กันทั้งหน้า (FirmwareEngineer/QAEngineer เป็น "-" ตาม
 * RBAC_Matrix.md §2 แถว "Campaign Wizard") — mirror `campaigns-table.tsx`
 */
export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const { data, isLoading, error, refetch } = useCampaign(campaignId);
  const targetsQuery = useCampaignTargets(campaignId);
  const rolloutsQuery = useCampaignRollouts(campaignId);
  // Rollout ล่าสุดของกลุ่ม (เรียง createdAt desc จาก backend อยู่แล้ว — และ
  // เป็นตัวเดียวที่ "ยังไม่จบ" ได้เสมอ เพราะกลุ่มหนึ่งรัน Rollout ได้ทีละรอบ
  // เท่านั้น) ใช้เช็ค Approve/Release/Resume/Rollback ทั้งหมดตรงนี้เลย (§12.2
  // PDF: "Campaign Monitor" มี Pause/Resume/Rollback ในตัว — ขยายให้ครอบคลุม
  // Approve/Release ด้วย เพราะเดิมต้องกดเข้า Rollout Detail แยกไปอีกหน้า
  // กว่าจะเจอปุ่ม ผู้ใช้จริงบ่นว่ากดหลายสเตปเกินไป) — panel แต่ละตัวคืน
  // `null` เองถ้าสถานะ/สิทธิ์ไม่เข้าเงื่อนไข จึงเรียกได้เสมอโดยไม่ต้องเช็คซ้ำ
  // ที่นี่ (มีแค่ panel เดียวที่ขึ้นจริงต่อสถานะหนึ่ง ไม่มีทางซ้อนกัน)
  const latestRollout = (rolloutsQuery.data ?? [])[0] ?? null;
  const latestRolloutTargetsQuery = useCampaignRolloutTargets(
    campaignId,
    latestRollout?.id ?? null,
  );

  if (isLoading && !data) {
    return (
      <RoleGuard allow={canReadCampaign}>
        <DetailSkeleton />
      </RoleGuard>
    );
  }

  if (error || !data) {
    return (
      <RoleGuard allow={canReadCampaign}>
        <div className="flex flex-col gap-4">
          <ErrorState
            message={error ?? "ไม่พบกลุ่มนี้"}
            onRetry={() => void refetch()}
          />
          <Link
            href="/campaigns"
            className={
              buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"
            }
          >
            กลับไปรายการ
          </Link>
        </div>
      </RoleGuard>
    );
  }

  const rollouts = rolloutsQuery.data ?? [];
  const members = targetsQuery.data ?? [];
  const hasOpenRollout = rollouts.some((r) =>
    (OPEN_CAMPAIGN_ROLLOUT_STATUSES as readonly string[]).includes(r.status),
  );
  const canStartRollout = canCreateCampaign(session?.role);
  const latestTargets = latestRolloutTargetsQuery.data ?? [];
  const latestSummary = summarizeRolloutTargets(latestTargets);
  const showProgress =
    latestRollout !== null &&
    (latestRollout.status === "active" ||
      latestRollout.status === "paused" ||
      latestRollout.status === "completed") &&
    latestSummary.total > 0;

  const newRolloutButton = canStartRollout ? (
    hasOpenRollout ? (
      <DisabledWithReason reason="กลุ่มนี้มี Rollout ที่ยังไม่จบ ต้องรอให้จบก่อนถึงจะเริ่มรอบใหม่ได้">
        <span
          aria-disabled
          className={buttonVariants({
            variant: "outline",
            className: "pointer-events-none opacity-50",
          })}
        >
          <RocketIcon /> Roll out ใหม่
        </span>
      </DisabledWithReason>
    ) : (
      <Link
        href={`/campaigns/${campaignId}/rollouts/new`}
        className={buttonVariants({ variant: "default" })}
      >
        <RocketIcon /> Roll out ใหม่
      </Link>
    )
  ) : null;

  return (
    <RoleGuard allow={canReadCampaign}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={data.name}
          description={data.description ?? undefined}
          breadcrumb={[{ label: data.name }]}
          meta={
            <PageHeaderMeta
              items={[
                { label: "สมาชิก", value: `${members.length} เครื่อง` },
                { label: "Rollout", value: `${rollouts.length} รอบ` },
                { label: "สร้างเมื่อ", value: formatDateTime(data.createdAt) },
              ]}
            />
          }
          actions={
            <>
              <RefreshControl />
              {newRolloutButton}
            </>
          }
        />

        {latestRollout ? (
          <Card className="gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="label-caps text-muted-foreground">
                  Rollout ล่าสุด
                </p>
                <p className="text-lg font-semibold">
                  {latestRollout.payloadType}
                </p>
                <p className="text-sm text-muted-foreground">
                  {getRolloutStatusExplanation(latestRollout.status)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill
                  tone={
                    CAMPAIGN_ROLLOUT_STATUS_TONE[latestRollout.status] ??
                    "neutral"
                  }
                >
                  {rolloutStatusLabel(latestRollout.status)}
                </StatusPill>
                <Link
                  href={`/campaigns/${campaignId}/rollouts/${latestRollout.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  ดูผลรายเครื่อง
                </Link>
              </div>
            </div>

            {showProgress ? (
              <RolloutProgressCard
                embedded
                status={latestRollout.status}
                payloadType={latestRollout.payloadType}
                summary={latestSummary}
                awaiting={isAwaitingTargetResults(
                  latestRollout.status,
                  latestTargets,
                )}
              />
            ) : (
              <p className="font-instrument text-sm tabular-nums text-muted-foreground">
                สำเร็จ{" "}
                <span className="font-medium text-success-foreground">
                  {latestRollout.successCount}
                </span>{" "}
                / ล้มเหลว{" "}
                <span className="font-medium text-danger-foreground">
                  {latestRollout.failureCount}
                </span>{" "}
                / ทั้งหมด {latestRollout.targetCount}
              </p>
            )}

            <CampaignRolloutApprovalPanel
              campaignId={campaignId}
              rollout={latestRollout}
              onDecided={() => void rolloutsQuery.refetch()}
            />
            <CampaignRolloutReleasePanel
              campaignId={campaignId}
              rollout={latestRollout}
              onReleased={() => void rolloutsQuery.refetch()}
              onRejected={() => void rolloutsQuery.refetch()}
            />
            <CampaignRolloutIncidentPanel
              campaignId={campaignId}
              rollout={latestRollout}
              targets={latestTargets}
              targetsLoading={
                latestRolloutTargetsQuery.isLoading &&
                !latestRolloutTargetsQuery.data
              }
              targetsError={latestRolloutTargetsQuery.error}
              onResumed={() => void rolloutsQuery.refetch()}
            />
          </Card>
        ) : (
          !rolloutsQuery.isLoading && (
            <EmptyState
              icon={RocketIcon}
              message="กลุ่มนี้ยังไม่เคย Roll out เริ่มรอบแรกเพื่อส่ง Config หรือ Firmware เข้ากลุ่ม"
              action={newRolloutButton}
            />
          )
        )}

        <UrlTabs
          tabs={[
            {
              id: "members",
              label: "สมาชิกกลุ่ม",
              count: members.length,
              content:
                targetsQuery.isLoading && !targetsQuery.data ? (
                  <TableSkeleton columns={3} rows={3} />
                ) : targetsQuery.error ? (
                  <ErrorState
                    message={targetsQuery.error}
                    onRetry={() => void targetsQuery.refetch()}
                  />
                ) : members.length === 0 ? (
                  <EmptyState
                    icon={HardDriveIcon}
                    message="กลุ่มนี้ยังไม่มีสมาชิก"
                  />
                ) : (
                  <div className="overflow-x-auto rounded-lg border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>เลขเครื่อง</TableHead>
                          <TableHead className="text-right">
                            เพิ่มเข้ากลุ่มเมื่อ
                          </TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map((target) => (
                          <TableRow key={target.id}>
                            <TableCell className="font-instrument text-xs">
                              {target.deviceId}
                            </TableCell>
                            <TableCell
                              className="text-right text-muted-foreground"
                              title={formatDateTime(target.createdAt)}
                            >
                              {formatRelativeTime(target.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <DeviceHistorySheet deviceId={target.deviceId} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ),
            },
            {
              id: "history",
              label: "ประวัติ Rollout",
              count: rollouts.length,
              content:
                rolloutsQuery.isLoading && !rolloutsQuery.data ? (
                  <TableSkeleton columns={4} rows={3} />
                ) : rolloutsQuery.error ? (
                  <ErrorState
                    message={rolloutsQuery.error}
                    onRetry={() => void rolloutsQuery.refetch()}
                  />
                ) : rollouts.length === 0 ? (
                  <EmptyState
                    icon={HardDriveIcon}
                    message="กลุ่มนี้ยังไม่เคย Roll out payload เลย"
                  />
                ) : (
                  <div className="overflow-x-auto rounded-lg border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>สถานะ</TableHead>
                          <TableHead>Payload</TableHead>
                          <TableHead className="text-right">
                            สำเร็จ / ล้มเหลว / ทั้งหมด
                          </TableHead>
                          <TableHead className="text-right">
                            สร้างเมื่อ
                          </TableHead>
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
                                  CAMPAIGN_ROLLOUT_STATUS_TONE[
                                    rollout.status
                                  ] ?? "neutral"
                                }
                              >
                                {rolloutStatusLabel(rollout.status)}
                              </StatusPill>
                            </TableCell>
                            <TableCell>{rollout.payloadType}</TableCell>
                            <TableCell className="font-instrument text-right tabular-nums">
                              <span className="text-success-foreground">
                                {rollout.successCount}
                              </span>
                              <span className="text-muted-foreground"> / </span>
                              <span className="text-danger-foreground">
                                {rollout.failureCount}
                              </span>
                              <span className="text-muted-foreground">
                                {" "}
                                / {rollout.targetCount}
                              </span>
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
                ),
            },
          ]}
        />
      </div>
    </RoleGuard>
  );
}
