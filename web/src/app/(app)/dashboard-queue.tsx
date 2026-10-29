"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRightIcon } from "lucide-react";

import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusLed, type LedTone } from "@/components/ui/status-led";
import { useConfigs } from "@/hooks/use-configs";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { usePendingCampaignRollouts } from "@/hooks/use-pending-campaign-rollouts";
import { usePendingDeviceConfigOverrides } from "@/hooks/use-pending-device-config-overrides";
import { usePendingDeviceFirmwareOverrides } from "@/hooks/use-pending-device-firmware-overrides";
import type { CampaignRollout } from "@/lib/campaign-api";
import { rolloutsAwaitingRelease } from "@/lib/dashboard-metrics";
import {
  oldestIso,
  sortQueue,
  waitingLabel,
  type QueueItem,
  type QueueTone,
} from "@/lib/dashboard-queue";
import type { Firmware } from "@/lib/firmware-api";
import { cn } from "@/lib/utils";
import { Panel } from "./dashboard-panel";

const TONE_LED: Record<QueueTone, LedTone> = {
  danger: "danger",
  warning: "warning",
  info: "info",
};

const TONE_COUNT: Record<QueueTone, string> = {
  danger: "text-danger-foreground",
  warning: "text-warning-foreground",
  info: "text-info-foreground",
};

const TONE_STRIPE: Record<QueueTone, string> = {
  danger: "before:bg-destructive",
  warning: "before:bg-warning",
  info: "before:bg-info",
};

/**
 * การ์ด "งานที่ต้องดำเนินการ" — คิวงานของ Role นั้น แต่ละแถว = งานหนึ่งอย่าง: ชื่อ,
 * ค้างมานานแค่ไหน, จำนวน, กดไปทำเลย · ไม่มีงานค้าง = บอกชัดว่าเรียบร้อย
 * (ไม่ปล่อยพื้นที่ว่าง)
 */
function QueueCard({
  items,
  loading,
  error,
  onRetry,
  className,
}: {
  items: QueueItem[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const queue = useMemo(() => sortQueue(items), [items]);
  const total = queue.reduce((n, i) => n + i.count, 0);

  return (
    <Panel
      title="งานที่ต้องดำเนินการ"
      description={
        loading || error
          ? undefined
          : queue.length > 0
            ? `${queue.length} เรื่อง รวม ${total.toLocaleString("th-TH")} รายการ`
            : undefined
      }
      className={className}
    >
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : queue.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <StatusLed tone="online" className="size-3" />
          <p className="text-sm font-medium">ไม่มีงานค้างตอนนี้</p>
          <p className="text-xs text-muted-foreground">
            งานใหม่จะขึ้นที่นี่ทันทีที่มีเข้ามา
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.map((item) => {
            const body = (
              <>
                <StatusLed
                  tone={TONE_LED[item.tone]}
                  pulse={item.tone === "danger"}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{item.title}</span>
                  {item.detail && (
                    <span className="text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </span>
                <span
                  data-tabular
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    TONE_COUNT[item.tone],
                  )}
                >
                  {item.count.toLocaleString("th-TH")}
                </span>
                {item.href && (
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) group-hover/row:translate-x-0.5" />
                )}
              </>
            );
            const rowClass = cn(
              "group/row relative flex items-center gap-3 overflow-hidden rounded-lg border bg-card py-3 pr-3 pl-4 before:absolute before:inset-y-0 before:left-0 before:w-1",
              TONE_STRIPE[item.tone],
            );
            return (
              <li key={item.key}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className={cn(
                      rowClass,
                      "outline-none transition-colors duration-(--duration-fast) hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={rowClass}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Operation: ทุกอย่างที่รอให้ตัดสินใจ/ปล่อย + สิ่งผิดปกติที่ต้องตาม */
export function OperationQueue({
  rollouts,
  pausedCount,
  incidentCount,
  className,
}: {
  rollouts: CampaignRollout[] | null;
  pausedCount: number | null;
  incidentCount: number | null;
  className?: string;
}) {
  const configs = usePendingApprovals();
  const rolloutApprovals = usePendingCampaignRollouts();
  const configOverrides = usePendingDeviceConfigOverrides();
  const firmwareOverrides = usePendingDeviceFirmwareOverrides();

  const awaiting = rollouts ? rolloutsAwaitingRelease(rollouts) : [];
  const items: QueueItem[] = [
    {
      key: "paused",
      tone: "danger",
      title: "Rollout ที่ระบบหยุดเอง",
      detail: "เครื่องล้มเหลวเกินเกณฑ์ ต้องตัดสินใจ Resume หรือ Rollback",
      count: pausedCount ?? 0,
      href: "/campaigns",
    },
    {
      key: "incident",
      tone: "danger",
      title: "Incident ที่ยังต้องตาม",
      count: incidentCount ?? 0,
      href: "/incidents",
    },
    {
      key: "config",
      tone: "warning",
      title: "Config รออนุมัติ",
      detail: waitingLabel(oldestIso((configs.data ?? []).map((c) => c.queuedAt))),
      count: configs.data?.length ?? 0,
      href: "/approvals",
    },
    {
      key: "rollout-approval",
      tone: "warning",
      title: "Rollout รออนุมัติ",
      count: rolloutApprovals.data?.length ?? 0,
      href: "/approvals",
    },
    {
      key: "config-override",
      tone: "warning",
      title: "คำขอแก้ค่า Config เฉพาะเครื่อง",
      count: configOverrides.data?.length ?? 0,
      href: "/approvals",
    },
    {
      key: "firmware-override",
      tone: "warning",
      title: "คำขอ Firmware เฉพาะเครื่อง",
      count: firmwareOverrides.data?.length ?? 0,
      href: "/approvals",
    },
    {
      key: "release",
      tone: "warning",
      title: "Rollout อนุมัติแล้ว รอปล่อยเข้าอุปกรณ์",
      detail: waitingLabel(oldestIso(awaiting.map((r) => r.approvedAt ?? r.createdAt))),
      count: awaiting.length,
      href: "/campaigns",
    },
  ];

  const loading =
    configs.data === null &&
    rolloutApprovals.data === null &&
    (configs.isLoading || rolloutApprovals.isLoading);

  return <QueueCard items={items} loading={loading} error={null} className={className} />;
}

/** ST/OT: สิ่งที่ต้องตรวจที่อุปกรณ์ */
export function FieldQueue({
  incidentCount,
  offlineCount,
  driftCount,
  loading,
  className,
}: {
  incidentCount: number | null;
  offlineCount: number | null;
  driftCount: number | null;
  loading: boolean;
  className?: string;
}) {
  const items: QueueItem[] = [
    {
      key: "incident",
      tone: "danger",
      title: "Incident ที่ยังต้องตาม",
      count: incidentCount ?? 0,
      href: "/incidents",
    },
    {
      key: "offline",
      tone: "warning",
      title: "อุปกรณ์ออฟไลน์",
      detail: "ดูรายการเครื่องที่ไม่ได้เชื่อมต่ออยู่",
      count: offlineCount ?? 0,
      href: "/devices?connection=offline",
    },
    {
      key: "drift",
      tone: "warning",
      title: "อุปกรณ์ที่ Config ยังไม่อัปเดต",
      detail: "เปิดรายละเอียดของแต่ละเครื่องเพื่อดูเวอร์ชันที่รายงาน",
      count: driftCount ?? 0,
    },
  ];
  return <QueueCard items={items} loading={loading} error={null} className={className} />;
}

/** ConfigEngineer: Config ของตัวเองที่ต้องแก้หรือยังไม่ส่ง */
export function ConfigEngineerQueue({
  me,
  className,
}: {
  me: string | null;
  className?: string;
}) {
  const { data: configs, isLoading, error, refetch } = useConfigs();
  const mine = (configs ?? []).filter((c) => c.createdBy === me);
  const by = (status: string) => mine.filter((c) => c.status === status);
  const rejected = by("rejected");
  const drafts = by("draft");
  const testing = by("testing");

  const items: QueueItem[] = [
    {
      key: "rejected",
      tone: "danger",
      title: "Config ที่ถูกปฏิเสธ",
      detail:
        rejected.length === 1
          ? `${rejected[0].name} แก้ไขแล้วส่งใหม่`
          : "แก้ไขแล้วส่งใหม่",
      count: rejected.length,
      href: rejected.length === 1 ? `/config/${rejected[0].id}` : "/config",
    },
    {
      key: "draft",
      tone: "warning",
      title: "Config ฉบับร่างที่ยังไม่ส่งอนุมัติ",
      detail:
        drafts.length === 1
          ? drafts[0].name
          : waitingLabel(oldestIso(drafts.map((c) => c.createdAt))),
      count: drafts.length,
      href: drafts.length === 1 ? `/config/${drafts[0].id}` : "/config",
    },
    {
      key: "testing",
      tone: "info",
      title: "ส่งอนุมัติแล้ว รอผู้อนุมัติตัดสิน",
      detail: waitingLabel(oldestIso(testing.map((c) => c.updatedAt))),
      count: testing.length,
      href: "/config",
    },
  ];
  return (
    <QueueCard
      items={items}
      loading={isLoading && configs === null}
      error={error}
      onRetry={() => void refetch()}
      className={className}
    />
  );
}

/** QAEngineer: Firmware รอตรวจ · FirmwareEngineer: Firmware ของตัวเองที่ถูกปฏิเสธ/รอ QA */
export function FirmwareQueue({
  firmware,
  loading,
  error,
  onRetry,
  role,
  me,
  className,
}: {
  firmware: Firmware[] | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  role: "QAEngineer" | "FirmwareEngineer";
  me: string | null;
  className?: string;
}) {
  const all = firmware ?? [];
  const pending = all.filter((f) => f.approvalStatus === "pending_review");
  const items: QueueItem[] =
    role === "QAEngineer"
      ? [
          {
            key: "review",
            tone: "warning",
            title: "Firmware รอตรวจคุณภาพ",
            detail: waitingLabel(oldestIso(pending.map((f) => f.uploadedAt))),
            count: pending.length,
            href: "/firmware",
          },
        ]
      : [
          {
            key: "rejected",
            tone: "danger",
            title: "Firmware ของฉันที่ถูกปฏิเสธ",
            detail: "ตรวจเหตุผลแล้วอัปโหลดเวอร์ชันใหม่",
            count: all.filter(
              (f) => f.uploadedBy === me && f.approvalStatus === "rejected",
            ).length,
            href: "/firmware",
          },
          {
            key: "waiting",
            tone: "info",
            title: "ส่งตรวจแล้ว รอ QA ตัดสิน",
            detail: waitingLabel(
              oldestIso(
                pending.filter((f) => f.uploadedBy === me).map((f) => f.uploadedAt),
              ),
            ),
            count: pending.filter((f) => f.uploadedBy === me).length,
            href: "/firmware",
          },
        ];

  return (
    <QueueCard
      items={items}
      loading={loading && firmware === null}
      error={error}
      onRetry={onRetry}
      className={className}
    />
  );
}
