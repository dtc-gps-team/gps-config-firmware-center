"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  INCIDENT_SEVERITY_TONE,
  INCIDENT_STATUS_TONE,
  StatusPill,
} from "@/lib/status-pill";
import { formatDateTime, formatRelativeTime } from "@/lib/format-date";
import { canCloseIncident } from "@/lib/permissions";
import {
  FIELD_REPORT_SOURCE,
  type Incident,
  type IncidentDecisionOutcome,
  type IncidentDecisionResult,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incident-api";
import {
  failedDeviceSample,
  incidentImpact,
  incidentType,
  incidentTypeLabel,
  isIncidentActive,
  isIncidentClosed,
  rolloutImpactBar,
  rolloutKindLabel,
} from "@/lib/incident-display";
import { severityLabel, type IncidentGroup } from "@/lib/incident-group";
import { cn } from "@/lib/utils";
import { BulkCloseIncidentsDialog } from "./bulk-close-incidents-dialog";
import { IncidentActions } from "./incident-actions";

/** ขอบซ้ายบอกความรุนแรงตั้งแต่แวบแรก ใช้ token สถานะ ระดับต่ำเป็นเส้นจาง */
const SEVERITY_ACCENT: Record<IncidentSeverity, string> = {
  critical: "border-l-destructive",
  high: "border-l-warning",
  medium: "border-l-info",
  low: "border-l-muted-foreground/30",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "เปิดอยู่",
  investigating: "กำลังตรวจสอบ",
  rolled_back: "Rollback แล้ว",
  resolved: "แก้แล้ว",
  dismissed: "ไม่ต้องดำเนินการ",
};

/** Incident ที่ระบบสร้างเอง (Rollout / เขียน Config) มีคำอธิบายยาวที่ซ้ำกับ
 * ผลกระทบ: ในรายการไม่แสดง ดูได้เต็มที่หน้ารายละเอียด */
function hasSystemSummary(incident: Incident): boolean {
  const type = incidentType(incident);
  return type === "rollout-failure" || type === "config-sync-writer";
}

/**
 * Incident 1 เรื่อง (อาจเกิดซ้ำหลายครั้ง) เป็นแถวกะทัดรัด: ป้ายความรุนแรง/สถานะ + จำนวนครั้ง,
 * ชื่อเรื่อง, ผลกระทบบรรทัดเดียว, เวลาสัมพัทธ์ และปุ่มดำเนินการ · เกิดซ้ำ (>1) ขยายดูทีละครั้งได้
 * และปิดทั้งกลุ่มพร้อมกันได้ (เฉพาะที่ระบบสร้างเอง Field Report ต้องตัดสินใจรายใบ)
 */
export function IncidentGroupRow({
  group,
  reporterName,
  onDecided,
  onStale,
}: {
  group: IncidentGroup;
  reporterName: string | null;
  onDecided: (
    result: IncidentDecisionResult,
    outcome: IncidentDecisionOutcome,
  ) => void;
  onStale: () => void;
}) {
  const { session } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const incident = group.latest;
  const count = group.items.length;
  const kind = rolloutKindLabel(incident);
  const impact = incidentImpact(incident);
  const bar = rolloutImpactBar(incident);
  const sample = failedDeviceSample(incident, 3);
  const showDescription =
    Boolean(incident.description) && !hasSystemSummary(incident);
  const detailHref = `/incidents/${encodeURIComponent(incident.id)}`;
  const closed = isIncidentClosed(incident.status);

  const bulkClosable = group.items.filter(
    (i) =>
      i.source !== FIELD_REPORT_SOURCE &&
      isIncidentActive(i.status) &&
      canCloseIncident(session?.role),
  );

  return (
    <li
      className={cn(
        "rounded-lg border border-l-4 bg-card",
        SEVERITY_ACCENT[incident.severity],
        closed && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill tone={INCIDENT_SEVERITY_TONE[incident.severity]}>
              {severityLabel(incident.severity)}
            </StatusPill>
            <StatusPill tone={INCIDENT_STATUS_TONE[incident.status]}>
              {STATUS_LABEL[incident.status] ?? incident.status}
            </StatusPill>
            <span className="text-xs text-muted-foreground">
              {incidentTypeLabel(incidentType(incident))}
            </span>
            {kind && (
              <span className="text-xs text-muted-foreground">{kind}</span>
            )}
            {count > 1 && (
              <span className="font-instrument rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums text-secondary-foreground">
                เกิด {count} ครั้ง
              </span>
            )}
          </div>

          <Link
            href={detailHref}
            className="font-medium break-words underline-offset-2 hover:underline"
          >
            {incident.title}
          </Link>

          {impact && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>{impact.summary}</span>
              {bar && (
                <div
                  role="img"
                  aria-label="สัดส่วนเครื่องที่ล้มเหลวและถูกข้าม"
                  className="flex h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="bg-destructive"
                    style={{ width: `${bar.failedPct}%` }}
                  />
                  <div
                    className="bg-warning"
                    style={{ width: `${bar.skippedPct}%` }}
                  />
                </div>
              )}
              {impact.detail && (
                <span className="text-xs text-muted-foreground">
                  {impact.detail}
                </span>
              )}
            </div>
          )}

          {sample && (
            <span className="text-xs text-muted-foreground">
              <span className="font-instrument">{sample.shown.join(", ")}</span>
              {sample.remaining > 0 && ` และอีก ${sample.remaining} เครื่อง`}
            </span>
          )}

          {showDescription && (
            <p className="line-clamp-2 text-sm break-words text-muted-foreground">
              {incident.description}
            </p>
          )}

          {incident.reviewNote && (
            <p className="text-xs text-muted-foreground">
              หมายเหตุจาก Operation: {incident.reviewNote}
            </p>
          )}

          <p
            className="text-xs text-muted-foreground"
            title={formatDateTime(incident.createdAt)}
          >
            เกิดเมื่อ {formatRelativeTime(incident.createdAt)}
            {reporterName && ` · แจ้งโดย ${reporterName}`}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {count > 1 && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              ดูทั้ง {count} ครั้ง
              <ChevronDownIcon
                className={cn(
                  "transition-transform duration-(--duration-fast) ease-(--ease-standard)",
                  expanded && "rotate-180",
                )}
              />
            </Button>
          )}
          {bulkClosable.length > 1 ? (
            <BulkCloseIncidentsDialog
              incidents={bulkClosable}
              onDone={onStale}
            />
          ) : (
            <IncidentActions
              incident={incident}
              onDecided={onDecided}
              onStale={onStale}
            />
          )}
        </div>
      </div>

      {expanded && (
        <ul className="divide-y border-t bg-surface-sunken text-sm">
          {group.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
            >
              <span className="font-instrument text-xs text-muted-foreground">
                {formatDateTime(item.createdAt)}
              </span>
              <span className="flex items-center gap-2">
                <StatusPill tone={INCIDENT_STATUS_TONE[item.status]}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </StatusPill>
                <Link
                  href={`/incidents/${encodeURIComponent(item.id)}`}
                  className="text-xs underline-offset-2 hover:underline"
                >
                  ดูรายละเอียด
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
