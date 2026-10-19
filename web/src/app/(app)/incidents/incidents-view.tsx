"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCwIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIncidents } from "@/hooks/use-incidents";
import { useUserNames } from "@/hooks/use-user-names";
import { CardListSkeleton } from "@/components/skeleton/card-list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/format-date";
import { PageHeader } from "@/components/page-header";
import {
  INCIDENT_SEVERITY_TONE,
  INCIDENT_STATUS_TONE,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import {
  type Incident,
  type IncidentDecisionOutcome,
  type IncidentDecisionResult,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incident-api";
import {
  INCIDENT_TYPE_OPTIONS,
  failedDeviceSample,
  incidentImpact,
  rolloutImpactBar,
  incidentType,
  incidentTypeLabel,
  isIncidentClosed,
  rolloutKindLabel,
  type IncidentType,
} from "@/lib/incident-display";
import { IncidentActions } from "./incident-actions";

const INCIDENT_STATUS_OPTIONS: { value: IncidentStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "rolled_back", label: "Rollback แล้ว" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "ไม่ต้องดำเนินการ" },
];

type IncidentView = "open" | "closed" | "all";

const INCIDENT_VIEW_OPTIONS: { value: IncidentView; label: string }[] = [
  { value: "open", label: "ยังไม่ปิด" },
  { value: "closed", label: "ปิดแล้ว" },
  { value: "all", label: "ทั้งหมด" },
];

const INCIDENT_SEVERITY_OPTIONS: { value: IncidentSeverity; label: string }[] =
  [
    { value: "critical", label: "critical" },
    { value: "high", label: "high" },
    { value: "medium", label: "medium" },
    { value: "low", label: "low" },
  ];

/**
 * เนื้อหาจริงของหน้า Incident & Rollback — ต่อ `GET /incidents` จริงแล้ว
 * (read-only rollout, Sprint 2 — ดู RBAC_Matrix.md §2 "Incident & Rollback"
 * = R ทุก Role ไม่มี Role ไหนถูกกันออก ต่างจาก Audit Log) แยกเป็น client
 * component ต่างหากจาก page.tsx (server component ที่ export metadata)
 * mirror `audit-log-view.tsx`
 *
 * `IncidentActions` (สั่ง Rollback / แก้ไขเชิงเทคนิค) ยังเป็นปุ่ม disabled
 * scaffold อยู่ — endpoint เขียน (Update/Rollback) ยังไม่มีใน spec เลย
 * (ต่างจาก GET ที่ต่อจริงแล้วรอบนี้) ดู incident-actions.tsx
 */
export function IncidentsView() {
  const [status, setStatus] = useState<IncidentStatus | "">("");
  // ประเภท/ความรุนแรงกรองฝั่งเว็บ: `GET /incidents` กรองได้แค่สถานะ (ถ้ารายการ
  // โตมากค่อยย้ายไปกรองที่ backend)
  const [type, setType] = useState<IncidentType | "">("");
  const [severity, setSeverity] = useState<IncidentSeverity | "">("");
  const { data, isLoading, error, refetch } = useIncidents({
    status: status || undefined,
  });
  // มุมมองของรายการ: ยังไม่ปิด (ค่าเริ่มต้น) | ปิดแล้ว | ทั้งหมด · เป็นแท็บที่มี
  // จำนวนกำกับ กดอันไหนเห็นตามชื่อนั้นตรงๆ (เดิมเป็นช่องติ๊ก "แสดงที่ปิดแล้วด้วย"
  // ซึ่งแปลว่าเพิ่มที่ปิดแล้วเข้ามา ผู้ใช้เข้าใจว่าควรเห็นแต่ที่ปิดแล้ว จึงสับสน)
  // เลือกสถานะเจาะจงในตัวกรองสถานะ = ผู้ใช้ขอดูสถานะนั้นตรงๆ แท็บจึงไม่ทำงาน
  const [view, setView] = useState<IncidentView>("open");
  const matching = (data ?? []).filter(
    (i) =>
      (!type || incidentType(i) === type) &&
      (!severity || i.severity === severity),
  );
  const openCount = matching.filter((i) => !isIncidentClosed(i.status)).length;
  const closedCount = matching.length - openCount;
  const viewCounts: Record<IncidentView, number> = {
    open: openCount,
    closed: closedCount,
    all: matching.length,
  };
  const effectiveView: IncidentView = status ? "all" : view;
  const rows =
    effectiveView === "open"
      ? matching.filter((i) => !isIncidentClosed(i.status))
      : effectiveView === "closed"
        ? matching.filter((i) => isIncidentClosed(i.status))
        : matching;
  // มุมมอง "ทั้งหมด": แยก 2 กลุ่ม (ยังไม่ปิดก่อน ปิดแล้วตามหลัง) ไม่เรียงปนกันตาม
  // เวลา ไม่งั้นแยกไม่ออกว่าใบไหนยังต้องตัดสินใจ
  const openRows = rows.filter((i) => !isIncidentClosed(i.status));
  const closedRows = rows.filter((i) => isIncidentClosed(i.status));
  const grouped =
    effectiveView === "all" && openRows.length > 0 && closedRows.length > 0;
  const hasFilter = Boolean(status || type || severity);
  const router = useRouter();
  const { resolveName } = useUserNames();

  function handleDecided(
    result: IncidentDecisionResult,
    outcome: IncidentDecisionOutcome,
  ) {
    if (outcome === "promote") {
      // ส่งต่อเป็น Campaign: ไปสร้างกลุ่มอุปกรณ์ต่อทันที โดยผูก Incident นี้
      // (หน้านั้นดึงข้อมูล Incident เองด้วย id จึงไม่ต้องแนบอย่างอื่นมา)
      router.push(
        `/campaigns/new?sourceIncidentId=${encodeURIComponent(result.id)}`,
      );
      return;
    }
    void refetch();
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Incident & Rollback"
        description="ปัญหาที่ระบบตรวจพบหลังปล่อย Config หรือ Firmware และรายงานจากหน้างาน พร้อมสั่ง Rollback เมื่อจำเป็น"
      />

      <Card>
        <CardHeader>
          <CardTitle>
            รายการ Incident{" "}
            <span className="text-muted-foreground">({rows.length})</span>
          </CardTitle>
          <CardDescription>
            สร้างอัตโนมัติจากระบบเมื่อตรวจพบปัญหา เรียงจากล่าสุด
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isLoading}
            >
              <RefreshCwIcon className={isLoading ? "animate-spin" : ""} />
              รีเฟรช
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            role="group"
            aria-label="มุมมองรายการ"
            className="flex flex-wrap gap-1 border-b"
          >
            {INCIDENT_VIEW_OPTIONS.map((v) => {
              const active = v.value === effectiveView;
              return (
                <button
                  key={v.value}
                  type="button"
                  aria-pressed={active}
                  disabled={Boolean(status)}
                  title={
                    status ? "กำลังใช้ตัวกรองสถานะอยู่ แท็บนี้ไม่ทำงาน" : undefined
                  }
                  onClick={() => setView(v.value)}
                  className={cn(
                    "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60",
                    active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v.label}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      v.value === "open" && viewCounts.open > 0
                        ? "bg-warning-subtle text-warning-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {viewCounts[v.value]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus((value ?? "") as IncidentStatus | "")
              }
            >
              <SelectTrigger className="h-8 max-w-48" aria-label="กรองตามสถานะ">
                <SelectValue placeholder="สถานะ: ทั้งหมด">
                  {(value: string) =>
                    INCIDENT_STATUS_OPTIONS.find((s) => s.value === value)
                      ?.label ?? "สถานะ: ทั้งหมด"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">สถานะ: ทั้งหมด</SelectItem>
                {INCIDENT_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={type}
              onValueChange={(value) => setType((value ?? "") as IncidentType | "")}
            >
              <SelectTrigger className="h-8 max-w-52" aria-label="กรองตามประเภท">
                <SelectValue placeholder="ประเภท: ทั้งหมด">
                  {(value: string) =>
                    INCIDENT_TYPE_OPTIONS.find((o) => o.value === value)
                      ?.label ?? "ประเภท: ทั้งหมด"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">ประเภท: ทั้งหมด</SelectItem>
                {INCIDENT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={severity}
              onValueChange={(value) =>
                setSeverity((value ?? "") as IncidentSeverity | "")
              }
            >
              <SelectTrigger className="h-8 max-w-52" aria-label="กรองตามความรุนแรง">
                <SelectValue placeholder="ความรุนแรง: ทั้งหมด">
                  {(value: string) =>
                    INCIDENT_SEVERITY_OPTIONS.find((o) => o.value === value)
                      ?.label ?? "ความรุนแรง: ทั้งหมด"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">ความรุนแรง: ทั้งหมด</SelectItem>
                {INCIDENT_SEVERITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading && data === null ? (
            <CardListSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                ลองใหม่
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={
                hasFilter || matching.length > 0
                  ? SearchXIcon
                  : TriangleAlertIcon
              }
              message={
                hasFilter
                  ? "ไม่พบ Incident ที่ตรงกับเงื่อนไข"
                  : effectiveView === "open" && closedCount > 0
                    ? "ไม่มี Incident ที่ยังไม่ปิด"
                    : effectiveView === "closed" && openCount > 0
                      ? "ยังไม่มี Incident ที่ปิดแล้ว"
                      : "ยังไม่มี Incident"
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {[
                { key: "open", label: "ยังไม่ปิด", items: openRows },
                { key: "closed", label: "ปิดแล้ว", items: closedRows },
              ].flatMap(({ key, label, items }) => [
                grouped && (
                  <h3
                    key={`${key}-heading`}
                    className="mt-1 text-xs font-medium text-muted-foreground"
                  >
                    {label} ({items.length})
                  </h3>
                ),
                ...items.map((incident) => (
                  <IncidentCard
                    key={incident.id}
                    incident={incident}
                    reporterName={
                      incident.reportedBy
                        ? resolveName(incident.reportedBy)
                        : null
                    }
                    onDecided={handleDecided}
                    onStale={() => void refetch()}
                  />
                )),
              ])}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** ขอบซ้ายของการ์ดบอกความรุนแรงตั้งแต่แวบแรก (รูปแบบเดียวกับการ์ดใน Approval
 * Center ที่ใช้ขอบซ้ายสี) · ระดับต่ำใช้เส้นจาง ไม่แย่งสายตา */
const SEVERITY_ACCENT: Record<IncidentSeverity, string> = {
  critical: "border-l-destructive",
  high: "border-l-amber-500",
  medium: "border-l-sky-500",
  low: "border-l-muted-foreground/30",
};

/**
 * Incident 1 รายการ แบบการ์ด (แทนตารางเดิมที่ทุกช่องมีหลายบรรทัดจนล้นจอ)
 *
 * ลำดับให้สายตาไล่จากบนลงล่าง: ประเภท + ชื่อเรื่อง และป้ายความรุนแรง/สถานะ
 * ทางขวา -> ผลกระทบ (ตัวเลข + แถบสัดส่วน + ตัวอย่างเครื่อง) -> คำอธิบายที่ช่าง
 * เขียน -> เวลา/ผู้แจ้ง -> ปุ่ม · Incident ที่ระบบสร้างเองมีคำอธิบายยาวซ้ำกับ
 * ผลกระทบ จึงไม่แสดงในการ์ด (ดูเต็มที่หน้ารายละเอียด)
 */
function IncidentCard({
  incident,
  reporterName,
  onDecided,
  onStale,
}: {
  incident: Incident;
  reporterName: string | null;
  onDecided: (
    result: IncidentDecisionResult,
    outcome: IncidentDecisionOutcome,
  ) => void;
  onStale: () => void;
}) {
  const kind = rolloutKindLabel(incident);
  const impact = incidentImpact(incident);
  const bar = rolloutImpactBar(incident);
  const sample = failedDeviceSample(incident, 3);
  const showDescription =
    Boolean(incident.description) && !hasSystemSummary(incident);
  const detailHref = `/incidents/${encodeURIComponent(incident.id)}`;

  return (
    <Card
      className={`gap-3 border-l-4 ${SEVERITY_ACCENT[incident.severity]} ${
        isIncidentClosed(incident.status) ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="font-medium">
              {incidentTypeLabel(incidentType(incident))}
            </span>
            {kind && <span>{kind}</span>}
          </div>
          <Link
            href={detailHref}
            className="font-medium break-words underline-offset-2 hover:underline"
          >
            {incident.title}
          </Link>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <StatusPill tone={INCIDENT_SEVERITY_TONE[incident.severity]}>
            {incident.severity}
          </StatusPill>
          <StatusPill tone={INCIDENT_STATUS_TONE[incident.status]}>
            {statusLabel(incident.status)}
          </StatusPill>
        </div>
      </div>

      {impact && (
        <div className="flex flex-col gap-1.5 px-4">
          <span className="text-sm font-medium">{impact.summary}</span>
          {bar && (
            <div
              role="img"
              aria-label="สัดส่วนเครื่องที่ล้มเหลวและถูกข้าม"
              className="flex h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted"
            >
              <div
                className="bg-destructive"
                style={{ width: `${bar.failedPct}%` }}
              />
              <div
                className="bg-amber-400"
                style={{ width: `${bar.skippedPct}%` }}
              />
            </div>
          )}
          {impact.detail && (
            <span className="text-xs text-muted-foreground">
              {impact.detail}
            </span>
          )}
          {sample && (
            <span className="text-xs text-muted-foreground">
              <span className="font-mono">{sample.shown.join(", ")}</span>
              {sample.remaining > 0 && ` และอีก ${sample.remaining} เครื่อง`}
            </span>
          )}
        </div>
      )}

      {showDescription && (
        <p className="line-clamp-2 px-4 text-sm break-words text-muted-foreground">
          {incident.description}
        </p>
      )}

      {incident.reviewNote && (
        <p className="px-4 text-xs text-muted-foreground">
          หมายเหตุจาก Operation: {incident.reviewNote}
        </p>
      )}

      <p className="px-4 text-xs text-muted-foreground">
        เกิดเมื่อ {formatDateTime(incident.createdAt)}
        {reporterName && ` แจ้งโดย ${reporterName}`}
      </p>

      <div className="flex items-center justify-between gap-3 border-t px-4 pt-3">
        <Link
          href={detailHref}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          ดูรายละเอียด →
        </Link>
        <IncidentActions
          incident={incident}
          onDecided={onDecided}
          onStale={onStale}
        />
      </div>
    </Card>
  );
}

/** Incident ที่ระบบสร้างเอง (Rollout / เขียน Config) มีคำอธิบายยาวที่ซ้ำกับ
 * ผลกระทบ: ในการ์ดไม่แสดง ดูได้เต็มที่หน้ารายละเอียด Incident */
function hasSystemSummary(incident: Incident): boolean {
  const type = incidentType(incident);
  return type === "rollout-failure" || type === "config-sync-writer";
}
