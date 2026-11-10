"use client";

import Link from "next/link";

import { ApplyAttemptHistory } from "@/components/apply-attempt-history";
import { useAuth } from "@/components/auth/auth-provider";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { useDeviceConfigOverride } from "@/hooks/use-device-config-override";
import { useFieldApplyRequest } from "@/hooks/use-field-apply-request";
import { useNow } from "@/hooks/use-now";
import type {
  FieldApplyProgress,
  FieldApplyRequest,
} from "@/lib/field-apply-request-api";
import {
  FIELD_APPLY_STATUS_LABEL,
  FIELD_APPLY_STATUS_TONE,
  badgeAttempt,
  failureTitle,
  isWaitingRetry,
  lastFailureReason,
  retryCountdownText,
  showAttemptHistory,
} from "@/lib/field-apply-retry-display";
import { formatDateTime } from "@/lib/format-date";
import { getTokenSubject } from "@/lib/jwt";
import { canDecideFieldApplyRequest } from "@/lib/permissions";
import { EntityTypeTag, StatusPill } from "@/lib/status-pill";
import { fieldApplySodBlockedReason } from "./field-apply-request-approval-card";
import { FieldApplyRequestApprovalActions } from "./field-apply-request-approval-actions";
import { OverrideFieldDiffList } from "./override-field-diff-list";

/** สถานะที่ยังไม่จบ มีเส้นตาย `expiresAt` ให้แสดง */
const HAS_DEADLINE = new Set(["pending", "approved"]);

/**
 * หน้ารายละเอียดคำขอส่ง Config/Firmware เข้ากล่องจากหน้างาน 1 รายการ
 * (`/approvals/field-apply/{id}`) — เดิมมีแค่การ์ดในคิว Approval Center ที่เห็นแค่
 * ชื่อ field หน้านี้เพิ่มค่าเดิม → ค่าที่ขอของ Override, ผู้ตัดสิน, เส้นตาย และความ
 * คืบหน้าการส่ง (รวมรอบที่ลองส่งใหม่) ใช้ได้ทุกสถานะ ปุ่มอนุมัติ/ปฏิเสธขึ้นเฉพาะ `pending`
 */
export function FieldApplyRequestDetailView({ id }: { id: string }) {
  const { data, progress, isLoading, error, refetch } = useFieldApplyRequest(id);

  if (isLoading && !data) return <DetailSkeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col gap-3 py-8">
        <ErrorState
          message={error ?? "ไม่พบคำขอนี้"}
          onRetry={() => void refetch()}
        />
        <Link
          href="/approvals"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "w-fit",
          })}
        >
          กลับไป Approval Center
        </Link>
      </div>
    );
  }

  return (
    <Content
      key={data.id}
      item={data}
      progress={progress}
      onDecided={() => void refetch()}
    />
  );
}

function Content({
  item,
  progress,
  onDecided,
}: {
  item: FieldApplyRequest;
  progress: FieldApplyProgress | null;
  onDecided: () => void;
}) {
  const { session } = useAuth();
  const canDecide = canDecideFieldApplyRequest(session?.role);
  const myUserId = session?.accessToken
    ? getTokenSubject(session.accessToken)
    : null;

  const isFirmware = item.kind === "firmware";
  const status = progress?.status ?? item.status;
  const inQueue = item.status === "pending";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={item.task.title || <span className="font-mono">{item.deviceId}</span>}
        breadcrumb={[{ label: item.task.title || item.deviceId }]}
        status={
          <>
            <EntityTypeTag type={isFirmware ? "Firmware" : "Config"} />
            <StatusPill tone={FIELD_APPLY_STATUS_TONE[status] ?? "neutral"}>
              {FIELD_APPLY_STATUS_LABEL[status] ?? status}
            </StatusPill>
          </>
        }
        description={item.note ?? undefined}
        meta={
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <MetaItem label="อุปกรณ์">
              <Link
                href={`/devices/${encodeURIComponent(item.deviceId)}`}
                className="font-mono underline-offset-4 hover:underline"
              >
                {item.deviceId}
              </Link>
            </MetaItem>
            <MetaItem label="ผู้ส่งคำขอ">{item.requester.fullName}</MetaItem>
            <MetaItem label="ส่งเมื่อ">{formatDateTime(item.requestedAt)}</MetaItem>
            {!isFirmware && item.configAssigner && (
              <MetaItem label="ผู้ผูก Config เข้างาน">
                {item.configAssigner.fullName}
              </MetaItem>
            )}
            {item.decider && (
              <MetaItem
                label={item.status === "rejected" ? "ปฏิเสธโดย" : "อนุมัติโดย"}
              >
                {item.decider.fullName}
              </MetaItem>
            )}
            {item.decidedAt && (
              <MetaItem label="ตัดสินใจเมื่อ">
                {formatDateTime(item.decidedAt)}
              </MetaItem>
            )}
            {HAS_DEADLINE.has(item.status) && (
              <MetaItem
                label={item.status === "pending" ? "หมดเวลาอนุมัติ" : "หมดเวลากดส่ง"}
              >
                {formatDateTime(item.expiresAt)}
              </MetaItem>
            )}
          </dl>
        }
        actions={
          inQueue && (
            <FieldApplyRequestApprovalActions
              id={item.id}
              deviceId={item.deviceId}
              canDecide={canDecide}
              sodBlockedReason={fieldApplySodBlockedReason(item, myUserId)}
              onDecided={onDecided}
            />
          )
        }
      />

      {!inQueue && item.status !== "approved" && (
        <Notice tone="warning">
          คำขอนี้ไม่อยู่ในคิวรออนุมัติแล้ว (สถานะ{" "}
          {FIELD_APPLY_STATUS_LABEL[item.status] ?? item.status})
        </Notice>
      )}

      {item.status === "approved" && (
        <Notice tone="info">
          อนุมัติแล้ว รอช่างที่ถืองานกดส่งเข้ากล่องเองจากแอป
        </Notice>
      )}

      {item.status === "rejected" && item.rejectReason && (
        <Notice tone="danger">เหตุผลที่ปฏิเสธ: {item.rejectReason}</Notice>
      )}

      {isFirmware && item.isDowngrade && (
        <Notice tone="warning">
          คำขอนี้เป็นการถอยเวอร์ชัน Firmware (เวอร์ชันที่ขอต่ำกว่าที่กล่องใช้อยู่)
        </Notice>
      )}

      {isFirmware ? <FirmwareSection item={item} /> : <ConfigSection item={item} />}

      {item.override && (
        <OverrideSection
          overrideId={item.override.id}
          reason={item.override.reason}
          configId={item.configId}
        />
      )}

      {progress && <ProgressSection progress={progress} />}
    </div>
  );
}

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FirmwareSection({ item }: { item: FieldApplyRequest }) {
  return (
    <Card className="gap-2 p-4">
      <p className="text-sm font-medium">Firmware ที่จะส่ง</p>
      <p className="text-sm">
        <span className="font-mono">{item.fromFirmwareVersion ?? "?"}</span>
        {" → "}
        <span className="font-mono">{item.firmware?.version ?? "?"}</span>
      </p>
      {item.fromFirmwareVersion === null && (
        <p className="text-xs text-muted-foreground">
          ไม่ทราบเวอร์ชันที่กล่องใช้อยู่ตอนขอ (ระบบไม่ได้ต่อ Server กลาง)
        </p>
      )}
    </Card>
  );
}

function ConfigSection({ item }: { item: FieldApplyRequest }) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Config ที่จะส่ง</p>
        {item.config ? (
          <p className="text-sm">
            <Link
              href={`/config/${encodeURIComponent(item.config.id)}`}
              className="underline-offset-4 hover:underline"
            >
              {item.config.name}
            </Link>{" "}
            <span className="text-muted-foreground">
              ({item.config.deviceModel}/{item.config.protocol})
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">ไม่พบ Config</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          field ที่จะส่ง ({item.fieldNames.length})
        </p>
        {item.fieldNames.length === 0 ? (
          <p className="text-sm text-muted-foreground">ไม่มีพารามิเตอร์</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {item.fieldNames.map((name) => (
              <span
                key={name}
                className="rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** ค่าที่ช่างขอแก้เฉพาะเครื่อง (Override) แบบค่าเดิม → ค่าที่ขอ อ่านจาก
 * `GET /device-config-overrides/{id}` (คิวคืนแค่ชื่อ field ไม่มีค่า) */
function OverrideSection({
  overrideId,
  reason,
  configId,
}: {
  overrideId: string;
  reason: string;
  configId: string | null;
}) {
  const { data, isLoading, error } = useDeviceConfigOverride(overrideId);

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">ค่าที่ช่างขอแก้เฉพาะเครื่อง (Override)</p>
        <p className="text-sm text-muted-foreground">เหตุผล: {reason}</p>
        <p className="text-xs text-amber-600">
          อนุมัติคำขอนี้ Override จะถูกอนุมัติไปด้วย
        </p>
      </div>
      {isLoading && !data ? (
        <p className="text-sm text-muted-foreground">กำลังโหลดค่าที่ขอแก้</p>
      ) : error || !data ? (
        <p className="text-sm text-destructive">
          {error ?? "โหลดค่าที่ขอแก้ไม่สำเร็จ"}
        </p>
      ) : (
        <OverrideFieldDiffList
          configId={configId ?? data.configId}
          fields={data.fields}
          className="text-sm"
        />
      )}
    </Card>
  );
}

function ProgressSection({ progress }: { progress: FieldApplyProgress }) {
  const waiting = isWaitingRetry(progress);
  const now = useNow(waiting);
  const retry = progress.retry;
  const attempts = retry?.attempts ?? [];
  const badge = badgeAttempt(progress);
  const failed =
    progress.status === "failed" || progress.status === "skipped_offline";

  return (
    <Card className="gap-3 p-4" data-testid="field-apply-progress">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">การส่งเข้ากล่อง</p>
        {badge !== null && retry && (
          <StatusPill tone="info">
            รอบ {badge}/{retry.maxAttempts}
          </StatusPill>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {progress.releasedAt && (
          <MetaItem label="กดส่งเมื่อ">{formatDateTime(progress.releasedAt)}</MetaItem>
        )}
        {progress.completedAt && (
          <MetaItem label="จบเมื่อ">{formatDateTime(progress.completedAt)}</MetaItem>
        )}
      </dl>
      {waiting && retry?.nextRetryAt && (
        <p className="text-sm font-medium" role="status">
          {retryCountdownText(retry.nextRetryAt, now)}
        </p>
      )}
      {failed && attempts.length > 0 && (
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="font-medium">{failureTitle(attempts)}</span>
          {lastFailureReason(attempts) && (
            <span className="text-muted-foreground">
              สาเหตุรอบสุดท้าย: {lastFailureReason(attempts)}
            </span>
          )}
        </div>
      )}
      {showAttemptHistory(attempts) && <ApplyAttemptHistory attempts={attempts} />}
    </Card>
  );
}
