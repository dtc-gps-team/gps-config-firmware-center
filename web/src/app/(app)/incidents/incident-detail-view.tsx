"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CalendarIcon,
  CpuIcon,
  FileCogIcon,
  RadioIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  UserIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
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
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">
          {error ?? "ไม่พบ Incident นี้"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            ลองใหม่
          </Button>
          <Link
            href="/incidents"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปรายการ
          </Link>
        </div>
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
  const reviewed = incident.reviewedBy !== null || incident.reviewNote !== null;

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
      />

      <Card className="max-w-xl p-4">
        {incident.description && (
          <p className="mb-3 border-b pb-3 text-sm whitespace-pre-wrap">
            {incident.description}
          </p>
        )}
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
                className="font-mono underline-offset-2 hover:underline"
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
          <InfoRow label="เกิดเมื่อ" icon={CalendarIcon}>
            {formatDateTime(incident.createdAt)}
          </InfoRow>
          <InfoRow label="อัปเดตล่าสุด" icon={RefreshCwIcon}>
            {formatDateTime(incident.updatedAt)}
          </InfoRow>
        </div>
      </Card>

      <RolloutImpactCard incident={incident} />

      {(technical.attempts !== null || technical.lastError !== null) && (
        <Card className="max-w-xl p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangleIcon className="size-4" />
            รายละเอียดทางเทคนิค
          </h2>
          <div className="divide-y">
            {technical.attempts !== null && (
              <InfoRow label="พยายามเขียนแล้ว">{technical.attempts} ครั้ง</InfoRow>
            )}
            {technical.lastError !== null && (
              <InfoRow label="ข้อผิดพลาดล่าสุด">
                <span className="font-mono text-xs">{technical.lastError}</span>
              </InfoRow>
            )}
          </div>
        </Card>
      )}

      {reviewed && (
        <Card className="max-w-xl p-4" aria-label="ผลการตรวจสอบ">
          <h2 className="mb-2 text-sm font-medium">ผลการตรวจสอบ</h2>
          <div className="divide-y">
            {incident.reviewedBy && (
              <InfoRow label="ตัดสินใจโดย" icon={UserIcon}>
                {resolveName(incident.reviewedBy)}
              </InfoRow>
            )}
            {incident.reviewedAt && (
              <InfoRow label="เมื่อ" icon={CalendarIcon}>
                {formatDateTime(incident.reviewedAt)}
              </InfoRow>
            )}
          </div>
          {incident.reviewNote && (
            <p className="mt-3 border-t pt-3 text-sm whitespace-pre-wrap">
              {incident.reviewNote}
            </p>
          )}
        </Card>
      )}

      <Card className="max-w-xl p-4">
        <h2 className="mb-2 text-sm font-medium">การดำเนินการ</h2>
        <IncidentActions
          incident={incident}
          onDecided={handleDecided}
          onStale={onChanged}
        />
      </Card>
    </div>
  );
}
