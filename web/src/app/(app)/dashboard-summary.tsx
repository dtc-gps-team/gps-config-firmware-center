"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { ErrorState } from "@/components/error-state";
import { KpiCard } from "@/components/kpi-card";
import { SegmentBar, type Segment } from "@/components/segment-bar";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfigs } from "@/hooks/use-configs";
import { useDevices } from "@/hooks/use-devices";
import { useCampaigns } from "@/hooks/use-campaigns";
import { useAllCampaignRollouts } from "@/hooks/use-all-campaign-rollouts";
import { useCentralDevices } from "@/hooks/use-central-devices";
import { useIncidents } from "@/hooks/use-incidents";
import { usePausedCampaignRollouts } from "@/hooks/use-paused-campaign-rollouts";
import {
  activeIncidentCount,
  configDriftCount,
  connectionSummary,
  deployTotals,
} from "@/lib/dashboard-metrics";
import { cn } from "@/lib/utils";
import { canReadCampaign } from "@/lib/permissions";
import {
  dashboardView,
  spanClass,
  type RiskId,
  type StatId,
  type SummaryPanelId,
} from "@/lib/dashboard-view";
import { Panel } from "./dashboard-panel";
import { DashboardRolloutsPanel } from "./dashboard-rollouts-panel";
import { DashboardSilentPanel } from "./dashboard-silent-panel";

/**
 * Dashboard — จัดเป็น 3 กลุ่มตาม docs/planning §12.1 (Device Overview /
 * Deployment Overview / Risk Dashboard) · **ทุกตัวเลขมาจากข้อมูลจริง** (ระบบของเราเอง และสถานะ
 * จริงของกล่องจาก Server กลาง) ไม่มีตัวเลขตายตัว: metric ที่ยังไม่มีแหล่งข้อมูลจริง (Reboot
 * Loop, Firmware Suspended ฯลฯ) ไม่แสดง แทนที่จะแสดงตัวเลขตัวอย่าง
 *
 * เลย์เอาต์ (รีโนเวท รอบ 1): ตอบคำถาม "ตอนนี้มีอะไรต้องให้ฉันทำ" ก่อน — แถวบน
 * คือการ์ดที่ต้องลงมือทำ (ค่า > 0 เน้นสีและกว้างกว่า, ค่า 0 ลดน้ำหนักเป็นปกติ)
 * ถัดมาคือผล Deploy กับสถานะการเชื่อมต่อ (ขนาดไม่เท่ากันตามความสำคัญ) และ
 * แถบตัวเลขนิ่งท้ายสุด · สีใช้ semantic token เท่านั้น ไม่มี hex ตายตัว
 */

/** เกณฑ์ล้มเหลวที่ Rollout หยุดอัตโนมัติ (ดูข้อความสถานะ paused ใน
 *  lib/status-pill.ts: "ล้มเหลวเกิน 5%") — ใช้เป็นเกณฑ์เตือนที่ Dashboard ด้วย */
const FAILURE_WARN_PERCENT = 5;

/** จำนวนคอลัมน์ของแถบการ์ดตามจำนวนช่อง (สตริงเต็มให้ Tailwind เห็น) */
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

export function DashboardSummary() {
  const { session } = useAuth();
  // FirmwareEngineer/QAEngineer ไม่มีสิทธิ์ `campaign:Read` (รีวิว #373) —
  // ข้ามการยิง `GET /campaigns*` ไปเลยแทนที่จะยิงแล้วได้ 403 แล้วซ่อนการ์ด
  // ที่พึ่งข้อมูลนี้ด้านล่างไปเลย ไม่โชว์ error
  const hasCampaignAccess = canReadCampaign(session?.role);
  const devices = useDevices();
  const configs = useConfigs();
  const campaigns = useCampaigns(hasCampaignAccess);
  const pausedRollouts = usePausedCampaignRollouts(hasCampaignAccess);
  const allRollouts = useAllCampaignRollouts(hasCampaignAccess);
  const incidents = useIncidents();
  // สถานะจริงของกล่องจาก Server กลาง (ข้อมูลเสริม: ติดต่อไม่ได้ก็ไม่ทำให้การ์ดอื่นพัง)
  const central = useCentralDevices();

  const deviceCount: number | null = devices.data ? devices.data.length : null;
  const modelCount: number | null = useMemo(
    () =>
      devices.data
        ? new Set(devices.data.map((d) => d.deviceModel)).size
        : null,
    [devices.data],
  );
  const pendingConfigCount: number | null = useMemo(
    () =>
      configs.data
        ? configs.data.filter((c) => c.status === "testing").length
        : null,
    [configs.data],
  );
  // `Campaign` (กลุ่ม) ไม่มี `status` อีกต่อไป (ย้ายไปอยู่ที่ `CampaignRollout`
  // แทน, Campaign Monitor #22) การ์ดนี้เลยนับจำนวนกลุ่มทั้งหมด
  const campaignCount: number | null = campaigns.data
    ? campaigns.data.length
    : null;
  // #238 review comment ข้อ 6 — นับจำนวน "Rollout ที่ paused" (นับเป็นกลุ่ม
  // ไม่ใช่รายเครื่อง) ไม่ใช่ "จำนวนเครื่องที่ Failure"
  const pausedRolloutCount: number | null = pausedRollouts.data
    ? pausedRollouts.data.length
    : null;

  const activeIncidents: number | null = incidents.data
    ? activeIncidentCount(incidents.data)
    : null;

  // ข้อมูลจาก Server กลางใช้ได้ต่อเมื่อโหลดสำเร็จและติดต่อได้ (reachable)
  const centralReady = central.data?.reachable === true;
  const centralUnavailable = central.data?.reachable === false;
  const centralLoading = central.data === null && central.isLoading;
  const centralIsMock = central.data?.mode === "mock";

  const connection = useMemo(
    () =>
      devices.data && centralReady && central.data
        ? connectionSummary(devices.data, central.data.devices)
        : null,
    [devices.data, centralReady, central.data],
  );
  const driftCount: number | null =
    devices.data && centralReady && central.data
      ? configDriftCount(devices.data, central.data.devices)
      : null;

  const deploy = useMemo(
    () => (allRollouts.data ? deployTotals(allRollouts.data) : null),
    [allRollouts.data],
  );
  const connectionSegments: Segment[] = connection
    ? [
        { key: "online", label: "ออนไลน์", value: connection.online, colorClass: "bg-success" },
        { key: "offline", label: "ออฟไลน์", value: connection.offline, colorClass: "bg-status-offline" },
        { key: "unknown", label: "ไม่ทราบ", value: connection.unknown, colorClass: "bg-muted-foreground/30" },
      ]
    : [];
  const deploySegments: Segment[] = deploy
    ? [
        { key: "success", label: "สำเร็จ", value: deploy.success, colorClass: "bg-success" },
        { key: "failed", label: "ล้มเหลว", value: deploy.failed, colorClass: "bg-destructive" },
      ]
    : [];
  const deployTotal = deploy ? deploy.success + deploy.failed : 0;
  const successPercent =
    deploy && deployTotal > 0
      ? Math.round((deploy.success / deployTotal) * 100)
      : null;
  const failurePercent =
    deploy && deployTotal > 0 ? (deploy.failed / deployTotal) * 100 : 0;

  const connectionEmpty = centralUnavailable
    ? "ติดต่อ Server กลางไม่ได้ตอนนี้ จึงยังไม่ทราบสถานะการเชื่อมต่อ"
    : "ยังไม่มีอุปกรณ์";
  const connectionLoading =
    centralLoading || (devices.data === null && devices.isLoading);
  const connectionTotal = connectionSegments.reduce((n, s) => n + s.value, 0);

  const centralDevices = central.data?.devices ?? null;
  const view = dashboardView(session?.role);
  const showRisk = (id: RiskId) => id !== "paused" || hasCampaignAccess;
  const riskItems = view.risk.filter(showRisk);
  const statItems = view.stats.filter(
    (id) => id !== "campaigns" || hasCampaignAccess,
  );
  const summaryPanels = view.summary.filter(
    (p) =>
      hasCampaignAccess || (p.id !== "rollouts" && p.id !== "deploy"),
  );

  const riskCard: Record<RiskId, React.ReactNode> = {
    paused: (
      <KpiCard
        plain
        label="Rollout หยุดชั่วคราว (Auto Pause)"
        href="/campaigns"
        value={pausedRolloutCount}
        error={pausedRollouts.error}
        tone="danger"
        emphasis="action"
        hint="Rollout ที่ระบบหยุดเองเพราะเครื่องล้มเหลวเกินเกณฑ์ ต้องตัดสินใจ Resume หรือ Rollback"
      />
    ),
    incident: (
      <KpiCard
        plain
        label="Incident ที่ยังต้องตาม"
        href="/incidents"
        value={activeIncidents}
        error={incidents.error}
        tone="danger"
        emphasis="action"
        hint="Incident ที่สถานะเปิดอยู่หรือกำลังตรวจสอบ"
      />
    ),
    offline: (
      <KpiCard
        plain
        label="อุปกรณ์ออฟไลน์"
        href="/devices"
        value={connection ? connection.offline : null}
        error={devices.error}
        unavailable={centralUnavailable}
        tone="warning"
        emphasis="action"
        hint="อุปกรณ์ในระบบที่ Server กลางรายงานว่าไม่ได้เชื่อมต่ออยู่"
      />
    ),
    drift: (
      <KpiCard
        plain
        label="อุปกรณ์ที่ Config ยังไม่อัปเดต"
        href="/devices"
        value={driftCount}
        error={devices.error}
        unavailable={centralUnavailable}
        tone="warning"
        emphasis="action"
        hint="อุปกรณ์ที่รายงานเวอร์ชัน Config ไม่ตรงกับเวอร์ชันที่ตั้งเป้าไว้"
      />
    ),
  };

  const statCard: Record<StatId, React.ReactNode> = {
    devices: (
      <KpiCard
        plain
        label="อุปกรณ์ทั้งหมด"
        href="/devices"
        value={deviceCount}
        error={devices.error}
      />
    ),
    models: (
      <KpiCard
        plain
        label="โมเดล"
        href="/devices"
        value={modelCount}
        error={devices.error}
      />
    ),
    configsPending: (
      <KpiCard
        plain
        label="Config รออนุมัติ"
        href="/approvals"
        value={pendingConfigCount}
        error={configs.error}
      />
    ),
    campaigns: (
      <KpiCard
        plain
        label="กลุ่มอุปกรณ์ทั้งหมด"
        href="/campaigns"
        value={campaignCount}
        error={campaigns.error}
      />
    ),
  };

  const summaryPanel: Record<SummaryPanelId, React.ReactNode> = {
    rollouts: (
      <DashboardRolloutsPanel
        rollouts={allRollouts.data}
        campaigns={campaigns.data}
        loading={allRollouts.isLoading}
        error={allRollouts.error}
        onRetry={() => void allRollouts.refetch?.()}
      />
    ),
    silent: (
      <DashboardSilentPanel
        devices={devices.data}
        central={centralDevices}
        loading={centralLoading || (devices.data === null && devices.isLoading)}
        error={devices.error}
        unavailable={centralUnavailable}
        onRetry={() => void devices.refetch?.()}
      />
    ),
    deploy: (
      <Panel title="ผลการ Deploy" href="/campaigns">
        {allRollouts.error ? (
          <ErrorState
            message="โหลดไม่สำเร็จ"
            onRetry={() => void allRollouts.refetch?.()}
          />
        ) : allRollouts.data === null && allRollouts.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : deployTotal === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีการ Deploy</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span
                data-tabular
                className="text-4xl font-semibold tracking-tight tabular-nums"
              >
                {successPercent}%
              </span>
              <span className="text-sm text-muted-foreground">ความสำเร็จ</span>
              <span
                data-tabular
                className="ml-auto text-xs text-muted-foreground"
              >
                {deployTotal.toLocaleString("th-TH")} เครื่อง
              </span>
            </div>
            <SegmentBar segments={deploySegments} />
            {failurePercent >= FAILURE_WARN_PERCENT && (
              <Notice tone="danger" className="mt-auto">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    ล้มเหลว {deploy?.failed} จาก {deployTotal} เครื่อง (
                    {Math.round(failurePercent)}%) สูงกว่าเกณฑ์{" "}
                    {FAILURE_WARN_PERCENT}%
                  </span>
                  <Link
                    href="/campaigns"
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    เปิดรายการ Campaign
                  </Link>
                </span>
              </Notice>
            )}
          </>
        )}
      </Panel>
    ),
    connection: (
      <Panel title="การเชื่อมต่อ (Online / Offline)" href="/devices">
        {devices.error ? (
          <ErrorState
            message="โหลดไม่สำเร็จ"
            onRetry={() => void devices.refetch?.()}
          />
        ) : connectionLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : connectionTotal === 0 ? (
          <p className="text-sm text-muted-foreground">{connectionEmpty}</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span
                data-tabular
                className="text-4xl font-semibold tracking-tight tabular-nums"
              >
                {connection?.online ?? 0}
              </span>
              <span className="text-sm text-muted-foreground">
                เครื่องที่เชื่อมต่ออยู่
              </span>
              <span
                data-tabular
                className="ml-auto text-xs text-muted-foreground"
              >
                {connectionTotal.toLocaleString("th-TH")} เครื่อง
              </span>
            </div>
            <SegmentBar segments={connectionSegments} />
          </>
        )}
      </Panel>
    ),
  };

  return (
    <div className="flex flex-col gap-6">
      {centralIsMock && (
        <Notice tone="info">
          <strong>ข้อมูลตัวอย่าง</strong> สถานะการเชื่อมต่อและ Config
          ที่กล่องรายงานมาจาก Server กลางในโหมดจำลอง
        </Notice>
      )}

      {/* ต้องลงมือทำ: แถบเดียว ช่องเท่ากัน เส้นแบ่งบางแทนการ์ดแยก ความต่างอยู่ที่สี
       * และตัวเลข (ค่า > 0 มีสีสถานะ + LED เต้น, ค่า 0 จางเป็น "ปกติ") ไม่ใช่ขนาดช่อง
       * รายการที่แสดงต่างกันตาม Role (lib/dashboard-view.ts) */}
      {riskItems.length > 0 && (
        <Card
          aria-label="ความเสี่ยง"
          className={cn(
            "grid gap-px overflow-hidden bg-border py-0",
            GRID_COLS[riskItems.length],
          )}
        >
          {riskItems.map((id) => (
            <Fragment key={id}>{riskCard[id]}</Fragment>
          ))}
        </Card>
      )}

      {summaryPanels.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-12 [&>*>*]:h-full">
          {summaryPanels.map((p) => (
            <div key={p.id} className={spanClass(p.span)}>
              {summaryPanel[p.id]}
            </div>
          ))}
        </div>
      )}

      {/* ตัวเลขนิ่ง: น้ำหนักต่ำ ไม่ใช้สี */}
      {statItems.length > 0 && (
        <Card
          aria-label="ภาพรวมอุปกรณ์"
          className={cn(
            "grid gap-px overflow-hidden bg-border py-0",
            GRID_COLS[statItems.length],
          )}
        >
          {statItems.map((id) => (
            <Fragment key={id}>{statCard[id]}</Fragment>
          ))}
        </Card>
      )}
    </div>
  );
}
