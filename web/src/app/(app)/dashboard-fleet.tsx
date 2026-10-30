"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { CountUp } from "@/components/motion/count-up";
import { RingGauge } from "@/components/ring-gauge";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { CentralDevice } from "@/lib/central-device-api";
import {
  capFleetDots,
  fleetDots,
  type FleetDot,
} from "@/lib/dashboard-metrics";
import type { Device } from "@/lib/device-api";
import { cn } from "@/lib/utils";
import { Panel, PanelEmpty } from "./dashboard-panel";

const STATUS_LABEL = {
  online: "ออนไลน์",
  offline: "ออฟไลน์",
  unknown: "ไม่ทราบ",
} as const;

/** สีจุด: เขียว = ออนไลน์, เทา = ออฟไลน์, เส้นประ = Server กลางไม่รู้จัก · วงแหวนอำพัน
 *  ล้อมจุด = Config ที่กล่องรายงานไม่ตรงกับที่ตั้งไว้ (ไม่ขึ้นกับสถานะการเชื่อมต่อ) */
const DOT_CLASS: Record<FleetDot["status"], string> = {
  online: "bg-success",
  offline: "bg-status-offline",
  unknown: "border border-dashed border-muted-foreground/60 bg-transparent",
};

const DRIFT_RING =
  "ring-2 ring-warning ring-offset-2 ring-offset-card";

/** ดีเลย์โผล่ทีละจุด (ms) — จำกัดเพดานไม่ให้กริดใหญ่โผล่นาน */
const DOT_STAGGER_MS = 6;
const DOT_STAGGER_MAX_MS = 500;

function dotText(dot: FleetDot): string {
  return `${dot.deviceId} · ${STATUS_LABEL[dot.status]}${dot.drift ? " · Config ไม่ตรง" : ""}`;
}

/** ข้อความในแถบอ่านค่าตอนไม่ได้ชี้จุดไหน: จำนวนเครื่อง (+ ส่วนที่กริดไม่ได้วาดถ้าเกินเพดาน) */
function idleReadout(
  view: { hiddenNormal: number; hiddenAbnormal: number },
  total: number,
): string {
  const parts: string[] = [];
  if (view.hiddenNormal > 0) {
    parts.push(`ปกติอีก ${view.hiddenNormal.toLocaleString("th-TH")} เครื่อง`);
  }
  if (view.hiddenAbnormal > 0) {
    parts.push(
      `ผิดปกติอีก ${view.hiddenAbnormal.toLocaleString("th-TH")} เครื่อง ดูที่หน้าอุปกรณ์`,
    );
  }
  return parts.length > 0
    ? parts.join(" · ")
    : `${total.toLocaleString("th-TH")} เครื่อง`;
}

function LegendItem({
  label,
  value,
  marker,
}: {
  label: string;
  value: number;
  marker: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-xs whitespace-nowrap">
      {marker}
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">
        <CountUp value={value} />
      </dd>
    </div>
  );
}

/**
 * สถานะอุปกรณ์ทั้งกอง: วงแหวนสัดส่วนออนไลน์ + กริดจุด LED (1 เครื่อง = 1 จุด) —
 * ข้อความอธิบายแทบไม่ต้องมี ตาอ่านจากสีและตำแหน่ง · ชี้/โฟกัสจุดแล้วเห็นรหัส
 * เครื่องในแถบอ่านค่า คลิกเปิดหน้าเครื่อง · เกิน `FLEET_GRID_CAP` เครื่อง กริดวาด
 * เฉพาะเครื่องที่ต้องสนใจ (กริดไม่ยาวตามจำนวนเครื่อง)
 */
export function DashboardFleet({
  devices,
  central,
  loading,
  error,
  unavailable,
  onRetry,
  className,
}: {
  devices: Device[] | null;
  central: CentralDevice[] | null;
  loading: boolean;
  error: string | null;
  /** ติดต่อ Server กลางไม่ได้ จึงไม่ทราบสถานะการเชื่อมต่อ */
  unavailable: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  const [active, setActive] = useState<FleetDot | null>(null);
  const dots = useMemo(
    () => (devices && central ? fleetDots(devices, central) : null),
    [devices, central],
  );
  const view = useMemo(() => (dots ? capFleetDots(dots) : null), [dots]);

  const count = (pick: (d: FleetDot) => boolean) =>
    (dots ?? []).filter(pick).length;
  const online = count((d) => d.status === "online");
  const offline = count((d) => d.status === "offline");
  const unknown = count((d) => d.status === "unknown");
  const drift = count((d) => d.drift);
  const total = dots?.length ?? 0;
  const percent = total > 0 ? Math.round((online / total) * 100) : 0;

  return (
    <Panel title="สถานะอุปกรณ์" href="/devices" className={className}>
      {error ? (
        <ErrorState message="โหลดไม่สำเร็จ" onRetry={onRetry} />
      ) : unavailable ? (
        <PanelEmpty>
          ติดต่อ Server กลางไม่ได้ตอนนี้ จึงยังไม่ทราบสถานะการเชื่อมต่อ
        </PanelEmpty>
      ) : loading || dots === null || view === null ? (
        <div className="flex items-center gap-5">
          <Skeleton className="size-32 shrink-0 rounded-full" />
          <Skeleton className="h-24 flex-1" />
        </div>
      ) : total === 0 ? (
        <PanelEmpty>ยังไม่มีอุปกรณ์</PanelEmpty>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <RingGauge
            label={`ออนไลน์ ${online} จาก ${total} เครื่อง`}
            segments={[
              { key: "online", label: "ออนไลน์", value: online, strokeClass: "stroke-success" },
              { key: "offline", label: "ออฟไลน์", value: offline, strokeClass: "stroke-status-offline" },
              { key: "unknown", label: "ไม่ทราบ", value: unknown, strokeClass: "stroke-muted-foreground/30" },
            ]}
          >
            <CountUp
              value={percent}
              suffix="%"
              className="text-3xl font-semibold tracking-tight"
            />
            <span className="text-xs text-muted-foreground">เชื่อมต่อ</span>
          </RingGauge>

          <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch">
            <dl className="flex flex-wrap gap-x-5 gap-y-1.5">
              <LegendItem
                label="ออนไลน์"
                value={online}
                marker={<span className="size-2 rounded-full bg-success" />}
              />
              <LegendItem
                label="ออฟไลน์"
                value={offline}
                marker={<span className="size-2 rounded-full bg-status-offline" />}
              />
              <LegendItem
                label="ไม่ทราบ"
                value={unknown}
                marker={
                  <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
                }
              />
              <LegendItem
                label="Config ไม่ตรง"
                value={drift}
                marker={
                  <span className="size-2 rounded-full bg-muted-foreground/40 ring-2 ring-warning ring-offset-1 ring-offset-card" />
                }
              />
            </dl>

            <ul
              aria-label="อุปกรณ์ทั้งหมด"
              className="flex flex-wrap gap-[7px]"
              onMouseLeave={() => setActive(null)}
            >
              {view.shown.map((dot, i) => (
                <li key={dot.deviceId}>
                  <Link
                    href={`/devices/${encodeURIComponent(dot.deviceId)}`}
                    aria-label={dotText(dot)}
                    onMouseEnter={() => setActive(dot)}
                    onFocus={() => setActive(dot)}
                    onBlur={() => setActive(null)}
                    style={{
                      animationDelay: `${Math.min(i * DOT_STAGGER_MS, DOT_STAGGER_MAX_MS)}ms`,
                    }}
                    className={cn(
                      "block size-3 animate-dot-in rounded-full outline-none transition-[transform,background-color] duration-(--duration-fast) hover:scale-150 focus-visible:scale-150 focus-visible:ring-2 focus-visible:ring-ring",
                      DOT_CLASS[dot.status],
                      dot.drift && DRIFT_RING,
                    )}
                  />
                </li>
              ))}
            </ul>

            <p
              aria-live="polite"
              className="font-instrument h-4 truncate text-xs text-muted-foreground"
            >
              {active ? dotText(active) : idleReadout(view, total)}
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
