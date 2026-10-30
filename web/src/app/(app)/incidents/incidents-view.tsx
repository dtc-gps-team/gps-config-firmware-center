"use client";

import { useRouter } from "next/navigation";
import { SearchXIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";
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
import { ErrorState } from "@/components/error-state";
import { RefreshControl } from "@/components/refresh-control";
import { useUrlParams } from "@/hooks/use-url-params";
import { PageHeader } from "@/components/page-header";
import {
  type IncidentDecisionOutcome,
  type IncidentDecisionResult,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incident-api";
import {
  INCIDENT_TYPE_OPTIONS,
  incidentType,
  isIncidentClosed,
  type IncidentType,
} from "@/lib/incident-display";
import { groupIncidents } from "@/lib/incident-group";
import { IncidentGroupRow } from "./incident-group-row";

const INCIDENT_STATUS_OPTIONS: { value: IncidentStatus; label: string }[] = [
  { value: "open", label: "เปิดอยู่" },
  { value: "investigating", label: "กำลังตรวจสอบ" },
  { value: "rolled_back", label: "Rollback แล้ว" },
  { value: "resolved", label: "แก้แล้ว" },
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
    { value: "critical", label: "วิกฤต" },
    { value: "high", label: "สูง" },
    { value: "medium", label: "ปานกลาง" },
    { value: "low", label: "ต่ำ" },
  ];

const URL_DEFAULTS = { status: "", type: "", severity: "", view: "open" };

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
  // ตัวกรองและมุมมองอยู่ใน URL (`?status=&type=&severity=&view=`)
  const { values, update } = useUrlParams(URL_DEFAULTS);
  const status = values.status as IncidentStatus | "";
  // ประเภท/ความรุนแรงกรองฝั่งเว็บ: `GET /incidents` กรองได้แค่สถานะ (ถ้ารายการ
  // โตมากค่อยย้ายไปกรองที่ backend)
  const type = values.type as IncidentType | "";
  const severity = values.severity as IncidentSeverity | "";
  const setStatus = (v: IncidentStatus | "") => update({ status: v });
  const setType = (v: IncidentType | "") => update({ type: v });
  const setSeverity = (v: IncidentSeverity | "") => update({ severity: v });
  const { data, isLoading, error, refetch } = useIncidents({
    status: status || undefined,
  });
  // มุมมองของรายการ: ยังไม่ปิด (ค่าเริ่มต้น) | ปิดแล้ว | ทั้งหมด · เป็นแท็บที่มี
  // จำนวนกำกับ กดอันไหนเห็นตามชื่อนั้นตรงๆ (เดิมเป็นช่องติ๊ก "แสดงที่ปิดแล้วด้วย"
  // ซึ่งแปลว่าเพิ่มที่ปิดแล้วเข้ามา ผู้ใช้เข้าใจว่าควรเห็นแต่ที่ปิดแล้ว จึงสับสน)
  // เลือกสถานะเจาะจงในตัวกรองสถานะ = ผู้ใช้ขอดูสถานะนั้นตรงๆ แท็บจึงไม่ทำงาน
  const view: IncidentView = INCIDENT_VIEW_OPTIONS.some(
    (o) => o.value === values.view,
  )
    ? (values.view as IncidentView)
    : "open";
  const setView = (v: IncidentView) => update({ view: v });
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
        actions={<RefreshControl />}
      />

      <div className="flex flex-col gap-3">
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
                  status
                    ? "กำลังใช้ตัวกรองสถานะอยู่ แท็บนี้ไม่ทำงาน"
                    : undefined
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
            onValueChange={(value) =>
              setType((value ?? "") as IncidentType | "")
            }
          >
            <SelectTrigger className="h-8 max-w-52" aria-label="กรองตามประเภท">
              <SelectValue placeholder="ประเภท: ทั้งหมด">
                {(value: string) =>
                  INCIDENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ??
                  "ประเภท: ทั้งหมด"
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
            <SelectTrigger
              className="h-8 max-w-52"
              aria-label="กรองตามความรุนแรง"
            >
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
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={
              hasFilter || matching.length > 0 ? SearchXIcon : TriangleAlertIcon
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
            ].map(({ key, label, items }) => {
              const groups = groupIncidents(items);
              if (groups.length === 0) return null;
              return (
                <section key={key} className="flex flex-col gap-2">
                  {grouped && (
                    <h3 className="mt-1 text-xs font-medium text-muted-foreground">
                      {label} ({items.length})
                    </h3>
                  )}
                  <ul className="flex flex-col gap-2">
                    {groups.map((group) => (
                      <IncidentGroupRow
                        key={group.key}
                        group={group}
                        reporterName={
                          group.latest.reportedBy
                            ? resolveName(group.latest.reportedBy)
                            : null
                        }
                        onDecided={handleDecided}
                        onStale={() => void refetch()}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
