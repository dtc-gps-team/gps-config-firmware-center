"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2Icon,
  ClipboardListIcon,
  CpuIcon,
  FileCogIcon,
  HistoryIcon,
  SendIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useDeviceHistory } from "@/hooks/use-device-history";
import { useUserNames } from "@/hooks/use-user-names";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  type DeviceHistoryItem,
  type DeviceHistoryType,
} from "@/lib/device-history-api";
import { visibleDeviceHistoryTypes } from "@/lib/permissions";
import { rolloutTargetStatusLabel } from "@/lib/rollout-target-display";
import {
  CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE,
  DEVICE_STATUS_TONE,
  INCIDENT_SEVERITY_TONE,
  INCIDENT_STATUS_TONE,
  StatusPill,
  TASK_STATUS_TONE,
  statusLabel,
  type PillTone,
} from "@/lib/status-pill";

/** approve/reject ของ Config/Firmware Override — ไม่มีตารางสีกลางของหน้าอื่น
 * ไว้ให้ reuse (สถานะนี้ใช้แค่ในเส้นเวลานี้ที่เดียว) */
const OVERRIDE_STATUS_TONE: Record<string, PillTone> = {
  pending: "progress",
  approved: "success",
  rejected: "danger",
};

const TYPE_LABEL: Record<DeviceHistoryType, string> = {
  lifecycle: "ลงทะเบียน/ติดตั้ง",
  rollout: "Rollout",
  "config-override": "Config เฉพาะเครื่อง",
  "firmware-override": "Firmware เฉพาะเครื่อง",
  task: "งาน",
  incident: "Incident",
};

const TYPE_ICON: Record<DeviceHistoryType, LucideIcon> = {
  lifecycle: CheckCircle2Icon,
  rollout: SendIcon,
  "config-override": SlidersHorizontalIcon,
  "firmware-override": CpuIcon,
  task: ClipboardListIcon,
  incident: TriangleAlertIcon,
};

function isKnownType(type: string): type is DeviceHistoryType {
  return type in TYPE_LABEL;
}

/** ป้ายสถานะของรายการ — เทียบตาม `type` เพราะชุดสถานะไม่เหมือนกัน (rollout
 * ใช้ pending/success/failed, override ใช้ pending/approved/rejected, ...) */
function statusTone(type: string, status: string): PillTone {
  switch (type) {
    case "rollout":
      return CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE[status] ?? "neutral";
    case "config-override":
    case "firmware-override":
      return OVERRIDE_STATUS_TONE[status] ?? "neutral";
    case "task":
      return TASK_STATUS_TONE[status] ?? "neutral";
    case "incident":
      return INCIDENT_STATUS_TONE[status] ?? "neutral";
    case "lifecycle":
      return DEVICE_STATUS_TONE[status] ?? "neutral";
    default:
      return "neutral";
  }
}

/** ป้ายข้อความของสถานะ — rollout ใช้คำแปลไทยเฉพาะของ `rollout-target-display.ts`
 * (#374) ชนิดอื่น fallback เป็น `statusLabel` กลางเหมือนหน้าอื่นในระบบ
 * (Incident/Task บางสถานะยังไม่มีคำแปลไทย ไม่ใช่ที่นี่ที่ควรไปแก้) */
function itemStatusLabel(type: string, status: string): string {
  if (type === "rollout") {
    return rolloutTargetStatusLabel(status);
  }
  return statusLabel(status);
}

/** ลิงก์ไปหน้ารายละเอียดที่เกี่ยวข้อง (ถ้ามีหน้าให้ไป) — override/task ยังไม่มี
 * หน้ารายละเอียดของตัวเองในเว็บ (override ดูที่ Approval Center, task เป็น
 * ของฝั่ง Mobile) จึงไม่มีลิงก์ให้ */
function historyItemLink(item: DeviceHistoryItem): string | null {
  if (item.type === "rollout" && item.refs.campaignId && item.refs.rolloutId) {
    return `/campaigns/${item.refs.campaignId}/rollouts/${item.refs.rolloutId}`;
  }
  if (item.type === "incident" && item.refs.incidentId) {
    return `/incidents/${item.refs.incidentId}`;
  }
  return null;
}

/** สีของวงไอคอนตามชนิดเหตุการณ์ — อ่านชนิดได้จากสีก่อนอ่านข้อความ */
const TYPE_TONE: Record<DeviceHistoryType, string> = {
  lifecycle: "bg-success-subtle text-success-foreground",
  rollout: "bg-info-subtle text-info-foreground",
  "config-override": "bg-warning-subtle text-warning-foreground",
  "firmware-override": "bg-warning-subtle text-warning-foreground",
  task: "bg-secondary text-secondary-foreground",
  incident: "bg-danger-subtle text-danger-foreground",
};

/** สถานะของ Task/Incident ที่ backend ส่งเป็นอังกฤษดิบ — แปลเฉพาะในเส้นเวลานี้ */
const RAW_STATUS_LABEL: Record<string, string> = {
  completed: "เสร็จสิ้น",
  open: "เปิดอยู่",
  in_progress: "กำลังดำเนินการ",
  investigating: "กำลังตรวจสอบ",
  resolved: "แก้ไขแล้ว",
  closed: "ปิดแล้ว",
  cancelled: "ยกเลิก",
  assigned: "มอบหมายแล้ว",
  installed: "ติดตั้งแล้ว",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "วันนี้" / "เมื่อวาน" / วันที่เต็ม — หัวข้อของกลุ่มรายวัน */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "ไม่ทราบวันที่";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(now.toISOString())) return "วันนี้";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "เมื่อวาน";
  return d.toLocaleDateString("th-TH", { dateStyle: "long" });
}

function groupByDay(items: DeviceHistoryItem[]) {
  const groups: { key: string; label: string; items: DeviceHistoryItem[] }[] =
    [];
  for (const item of items) {
    const key = dayKey(item.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.occurredAt), items: [item] });
  }
  return groups;
}

function HistoryItemRow({
  item,
  resolveName,
}: {
  item: DeviceHistoryItem;
  resolveName: (userId: string) => string;
}) {
  const type = item.type;
  const known = isKnownType(type);
  const Icon = known ? TYPE_ICON[type] : HistoryIcon;
  const typeLabel = known ? TYPE_LABEL[type] : type;
  const link = historyItemLink(item);
  const titleText = item.title ?? typeLabel;
  const statusText = item.status
    ? type === "rollout"
      ? itemStatusLabel(type, item.status)
      : (RAW_STATUS_LABEL[item.status] ?? itemStatusLabel(type, item.status))
    : null;

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-md py-0.5">
      <p className="text-sm font-medium break-words">{titleText}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{typeLabel}</span>
        {item.status && statusText && (
          <StatusPill tone={statusTone(item.type, item.status)}>
            {statusText}
          </StatusPill>
        )}
        {item.severity && (
          <StatusPill tone={INCIDENT_SEVERITY_TONE[item.severity] ?? "neutral"}>
            {item.severity}
          </StatusPill>
        )}
        {item.payloadType && (
          <span>
            {item.payloadType}
            {item.isRollback ? " (Rollback)" : ""}
          </span>
        )}
      </div>
      {item.config && (
        <p className="text-xs text-muted-foreground">
          Config: {item.config.name}
          {item.config.versionNumber !== null &&
            ` (เวอร์ชัน #${item.config.versionNumber})`}
        </p>
      )}
      {item.firmware && (
        <p className="text-xs text-muted-foreground">
          Firmware: v{item.firmware.version}
        </p>
      )}
      {item.detail && (
        <p className="text-sm text-muted-foreground">{item.detail}</p>
      )}
      {item.decision && (
        <p className="text-xs text-muted-foreground">
          ตัดสินใจโดย {resolveName(item.decision.byId ?? "")}
          {item.decision.at && ` เมื่อ ${formatDateTime(item.decision.at)}`}
          {item.decision.note && ` — ${item.decision.note}`}
        </p>
      )}
      <p
        data-tabular
        className="flex gap-2 text-xs text-muted-foreground"
        title={formatDateTime(item.occurredAt)}
      >
        {formatTime(item.occurredAt)}
        {item.actorId && <span>{resolveName(item.actorId)}</span>}
      </p>
    </div>
  );

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0 before:absolute before:top-8 before:bottom-0 before:left-4 before:w-px before:-translate-x-1/2 before:bg-border last:before:hidden">
      <span
        className={cn(
          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full",
          known ? TYPE_TONE[type] : "bg-secondary text-secondary-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      {link ? (
        <Link
          href={link}
          className="-mx-2 flex min-w-0 flex-1 rounded-md px-2 outline-none transition-colors duration-(--duration-fast) hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/** ปุ่มกรองประเภท — เลือกได้หลายค่า: active = พื้นฟ้าอ่อน + ขอบ primary, ไม่ active = ขอบจาง */
function TypeFilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

export function DeviceHistoryTimeline({ deviceId }: { deviceId: string }) {
  const { session } = useAuth();
  // ซ่อน pill ของชนิดที่ role นี้ไม่มีสิทธิ์เห็นเลย (#378 รีวิว B บน #371) —
  // mirror การกรองฝั่ง backend กัน "กดปุ่มแล้วไม่มีผลอะไร"
  const [visibleTypes] = useState<DeviceHistoryType[]>(() =>
    visibleDeviceHistoryTypes(session?.role),
  );
  const [selectedTypes, setSelectedTypes] = useState<Set<DeviceHistoryType>>(
    () => new Set(visibleTypes),
  );
  const typesFilter =
    selectedTypes.size === visibleTypes.length ? undefined : [...selectedTypes];
  const {
    summary,
    items,
    nextCursor,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
  } = useDeviceHistory(deviceId, typesFilter);
  const { resolveName } = useUserNames();

  // กันเลือกประเภทสุดท้ายออก (เหลือ 0 ประเภท = งงว่า "ไม่กรอง" หรือ "ไม่โชว์
  // อะไรเลย") อย่างน้อยต้องเหลือเลือกไว้ 1 ประเภทเสมอ
  function toggleType(type: DeviceHistoryType) {
    setSelectedTypes((prev) => {
      if (prev.has(type) && prev.size === 1) return prev;
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const typeFilterBar = (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {visibleTypes.map((type) => (
        <TypeFilterButton
          key={type}
          active={selectedTypes.has(type)}
          onClick={() => toggleType(type)}
        >
          {TYPE_LABEL[type]}
        </TypeFilterButton>
      ))}
    </div>
  );

  if (isLoading && items.length === 0) {
    return (
      <>
        {typeFilterBar}
        <div className="flex flex-col gap-3 py-2" aria-label="กำลังโหลดประวัติ">
          <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      </>
    );
  }

  return (
    <>
      {typeFilterBar}
      {summary && (summary.currentConfig || summary.currentFirmware) && (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {summary.currentConfig && (
            <span className="inline-flex items-center gap-1">
              <FileCogIcon className="size-3.5" />
              ใช้อยู่: {summary.currentConfig.name}
            </span>
          )}
          {summary.currentFirmware && (
            <span className="inline-flex items-center gap-1">
              <CpuIcon className="size-3.5" />
              Firmware: v{summary.currentFirmware.version}
            </span>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {typesFilter
            ? "ไม่มีประวัติในประเภทที่เลือก"
            : "ยังไม่มีประวัติของเครื่องนี้"}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groupByDay(items).map((group) => (
            <section key={group.key} className="flex flex-col gap-3">
              <h3 className="label-caps text-muted-foreground">
                {group.label}
              </h3>
              <ul>
                {group.items.map((item) => (
                  <HistoryItemRow
                    key={item.id}
                    item={item}
                    resolveName={resolveName}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {nextCursor && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoadingMore}
            onClick={() => void loadMore()}
          >
            {isLoadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * ปุ่ม "ดูประวัติ" ที่เปิด Sheet แสดงเส้นเวลาของอุปกรณ์เครื่องเดียว (รีวิวพี่เลี้ยง
 * 19 ต.ค. 2569: "เครื่องนี้เคยทำอะไรมาบ้าง") รวมทุกชนิดเหตุการณ์ต่อ
 * `GET /devices/{deviceId}/history` — ใช้ได้ทั้งในหน้า Device Detail และตาราง
 * สมาชิก Campaign (ดูว่าเครื่องนี้ในกลุ่มเคยผ่าน Rollout/เวอร์ชันอะไรมาบ้าง)
 *
 * **เป็น Sheet ไม่ใช่การ์ดฝังอยู่ในหน้าตลอดเวลา** (แก้ตามรีวิว — เดิมฝังเป็น
 * การ์ดใหญ่ถาวรทำให้หน้า Device Detail เลื่อนยาวเกินไป) โหลดข้อมูลแบบ lazy
 * ตอนเปิด Sheet เท่านั้น (`useDeviceHistory(deviceId, open)`) กันตารางที่มี
 * หลายเครื่องยิงคำขอพร้อมกันทุกแถวทั้งที่ยังไม่ได้เปิดดู · `type` ที่ไม่รู้จัก
 * (backend เพิ่มชนิดใหม่ในอนาคต) แสดง fallback เป็นไอคอน/ข้อความดิบ ไม่พัง ·
 * pill กรองชนิดซ่อนชนิดที่ role ของผู้เรียกไม่มีสิทธิ์เห็นเลยด้วย (#378 รีวิว
 * B บน #371 — ดู `visibleDeviceHistoryTypes` ใน `lib/permissions.ts`)
 */
export function DeviceHistorySheet({ deviceId }: { deviceId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <HistoryIcon className="size-4" />
            ดูประวัติ
          </Button>
        }
      />
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            ประวัติของ <span className="font-instrument">{deviceId}</span>
          </SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-4">
          {open && <DeviceHistoryTimeline deviceId={deviceId} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
