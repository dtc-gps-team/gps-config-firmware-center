"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CpuIcon,
  FileCogIcon,
  RadioIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  UserIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { ErrorState } from "@/components/error-state";
import { EventTimeline, type TimelineEvent } from "@/components/event-timeline";
import type { LedTone } from "@/components/ui/status-led";
import { useIncident } from "@/hooks/use-incident";
import { useUserNames } from "@/hooks/use-user-names";
import { formatDateTime } from "@/lib/format-date";
import {
  incidentSourceLabel,
  incidentTechnicalDetails,
} from "@/lib/incident-display";
import type {
  Incident,
  IncidentDecisionOutcome,
  IncidentDecisionResult,
} from "@/lib/incident-api";
import {
  INCIDENT_SEVERITY_TONE,
  INCIDENT_STATUS_TONE,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import { PageHeader } from "@/components/page-header";
import { IncidentActions } from "./incident-actions";
import { RolloutImpactCard } from "./rollout-impact-card";

/**
 * หน้ารายละเอียด Incident (`/incidents/{id}`) — ต่อ `GET /incidents/{id}` ที่มี
 * อยู่แล้ว ไม่แตะ backend · เป็นปลายทางของลิงก์จากกระดิ่งแจ้งเตือนและจากชื่อ
 * เรื่องในตาราง และเป็นที่ที่ Operation เห็นข้อมูลครบก่อนตัดสินใจ Field Report
 * (ตารางรายการแสดงแค่สรุป ไม่มีเวลาตัดสินใจ/Config และ Firmware ที่เกี่ยวข้อง)
 */
export function IncidentDetailView({ incidentId }: { incidentId: string }) {
  const { data, isLoading, error, refetch } = useIncident(incidentId);

  if (isLoading && !data) {
    return <DetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          message={error ?? "ไม่พบ Incident นี้"}
          onRetry={() => void refetch()}
        />
        <Link
          href="/incidents"
          className={
            buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"
          }
        >
          กลับไปรายการ
        </Link>
      </div>
    );
  }

  return (
    <IncidentDetailContent
      key={data.id}
      incident={data}
      onChanged={() => void refetch()}
    />
  );
}

const STATUS_LED: Record<string, LedTone> = {
  open: "danger",
  investigating: "warning",
  rolled_back: "info",
  resolved: "online",
  dismissed: "neutral",
};

/** เหตุการณ์ของ Incident เฉพาะที่มีข้อมูลจริงใน record (ตรวจพบ → ตัดสินใจ) API ยังไม่เก็บประวัติเปลี่ยนสถานะรายขั้น */
function buildTimeline(
  incident: Incident,
  resolveName: (id: string) => string,
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: "created",
      time: formatDateTime(incident.createdAt),
      title: "ตรวจพบ Incident",
      tone:
        incident.severity === "critical" || incident.severity === "high"
          ? "danger"
          : "warning",
    },
  ];
  if (incident.reviewedAt || incident.reviewedBy) {
    events.push({
      id: "reviewed",
      time: incident.reviewedAt ? formatDateTime(incident.reviewedAt) : "-",
      title: `ตัดสินใจ: ${statusLabel(incident.status)}`,
      tone: STATUS_LED[incident.status] ?? "neutral",
      detail: (
        <>
          {incident.reviewedBy && <p>โดย {resolveName(incident.reviewedBy)}</p>}
          {incident.reviewNote && (
            <p className="mt-1 whitespace-pre-wrap text-foreground">
              {incident.reviewNote}
            </p>
          )}
        </>
      ),
    });
  } else {
    events.push({
      id: "current",
      time: formatDateTime(incident.updatedAt),
      title: `สถานะปัจจุบัน: ${statusLabel(incident.status)}`,
      tone: STATUS_LED[incident.status] ?? "neutral",
    });
  }
  return events;
}

function IncidentDetailContent({
  incident,
  onChanged,
}: {
  incident: Incident;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { resolveName } = useUserNames();
  const sourceLabel = incidentSourceLabel(incident.source);
  const technical = incidentTechnicalDetails(incident.metadata);

  function handleDecided(
    result: IncidentDecisionResult,
    outcome: IncidentDecisionOutcome,
  ) {
    if (outcome === "promote") {
      // ส่งต่อเป็น Campaign: ไปสร้างกลุ่มอุปกรณ์ต่อทันที (เหมือนในตารางรายการ)
      router.push(
        `/campaigns/new?sourceIncidentId=${encodeURIComponent(result.id)}`,
      );
      return;
    }
    onChanged();
  }

  const events = buildTimeline(incident, resolveName);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={incident.title}
        breadcrumb={[{ label: incident.title }]}
        status={
          <>
            <StatusPill tone={INCIDENT_SEVERITY_TONE[incident.severity]}>
              {incident.severity}
            </StatusPill>
            <StatusPill tone={INCIDENT_STATUS_TONE[incident.status]}>
              {statusLabel(incident.status)}
            </StatusPill>
          </>
        }
        actions={
          <IncidentActions
            incident={incident}
            onDecided={handleDecided}
            onStale={onChanged}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <RolloutImpactCard incident={incident} />

          {incident.description && (
            <Card className="p-4">
              <h2 className="label-caps mb-2 text-muted-foreground">
                รายละเอียด
              </h2>
              <p className="text-sm whitespace-pre-wrap">
                {incident.description}
              </p>
            </Card>
          )}

          {(technical.attempts !== null || technical.lastError !== null) && (
            <Card className="p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangleIcon className="size-4" />
                รายละเอียดทางเทคนิค
              </h2>
              <div className="divide-y">
                {technical.attempts !== null && (
                  <InfoRow label="พยายามเขียนแล้ว">
                    {technical.attempts} ครั้ง
                  </InfoRow>
                )}
                {technical.lastError !== null && (
                  <InfoRow label="ข้อผิดพลาดล่าสุด">
                    <span className="font-instrument text-xs">
                      {technical.lastError}
                    </span>
                  </InfoRow>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="p-4">
            <h2 className="label-caps mb-3 text-muted-foreground">ไทม์ไลน์</h2>
            <EventTimeline events={events} label="ไทม์ไลน์ของ Incident" />
          </Card>

          <Card className="p-4">
            <div className="divide-y">
              {sourceLabel && (
                <InfoRow label="ที่มา" icon={RadioIcon}>
                  {sourceLabel}
                </InfoRow>
              )}
              {incident.deviceId && (
                <InfoRow label="อุปกรณ์" icon={SmartphoneIcon}>
                  <Link
                    href={`/devices/${encodeURIComponent(incident.deviceId)}`}
                    className="font-instrument underline-offset-2 hover:underline"
                  >
                    {incident.deviceId}
                  </Link>
                </InfoRow>
              )}
              {incident.relatedConfigId && (
                <InfoRow label="Config ที่เกี่ยวข้อง" icon={FileCogIcon}>
                  <Link
                    href={`/config/${encodeURIComponent(incident.relatedConfigId)}`}
                    className="underline-offset-2 hover:underline"
                  >
                    ดูรายละเอียด Config
                    {technical.versionNumber !== null &&
                      ` (v${technical.versionNumber})`}
                  </Link>
                </InfoRow>
              )}
              {incident.relatedFirmwareId && (
                <InfoRow label="Firmware ที่เกี่ยวข้อง" icon={CpuIcon}>
                  <Link
                    href={`/firmware/${encodeURIComponent(incident.relatedFirmwareId)}`}
                    className="underline-offset-2 hover:underline"
                  >
                    ดูรายละเอียด Firmware
                  </Link>
                </InfoRow>
              )}
              {incident.reportedBy && (
                <InfoRow label="ผู้แจ้ง" icon={UserIcon}>
                  {resolveName(incident.reportedBy)}
                </InfoRow>
              )}
              <InfoRow label="อัปเดตล่าสุด" icon={RefreshCwIcon}>
                {formatDateTime(incident.updatedAt)}
              </InfoRow>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
