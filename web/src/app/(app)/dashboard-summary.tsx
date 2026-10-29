"use client";

import { useMemo } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { SegmentBar, type Segment } from "@/components/segment-bar";
import { Notice } from "@/components/ui/notice";
import { useAllCampaignRollouts } from "@/hooks/use-all-campaign-rollouts";
import { useCampaigns } from "@/hooks/use-campaigns";
import { useCentralDevices } from "@/hooks/use-central-devices";
import { useDevices } from "@/hooks/use-devices";
import { useFirmwareList } from "@/hooks/use-firmware";
import { useIncidents } from "@/hooks/use-incidents";
import { usePausedCampaignRollouts } from "@/hooks/use-paused-campaign-rollouts";
import {
  activeIncidentCount,
  configDriftCount,
  connectionSummary,
  deployTotals,
} from "@/lib/dashboard-metrics";
import {
  dashboardView,
  spanClass,
  type HealthId,
  type PanelId,
} from "@/lib/dashboard-view";
import { getTokenSubject } from "@/lib/jwt";
import { canReadCampaign } from "@/lib/permissions";
import { DashboardActivity } from "./dashboard-activity";
import { DashboardConfigStatusChart } from "./dashboard-config-status-chart";
import { DashboardFirmwareStatus } from "./dashboard-firmware-status";
import { HealthCard, HealthRow } from "./dashboard-health";
import {
  ConfigEngineerQueue,
  FieldQueue,
  FirmwareQueue,
  OperationQueue,
} from "./dashboard-queue";
import { DashboardRolloutsPanel } from "./dashboard-rollouts-panel";
import { DashboardSilentPanel } from "./dashboard-silent-panel";

/**
 * Dashboard — ออกแบบจากงานของแต่ละ Role (ดู `lib/dashboard-view.ts`):
 * แถวบน = "งานที่ต้องดำเนินการ" (คิวงานของ Role) + "สถานะระบบ" (สรุปสั้น) แถวถัดไปเป็น
 * แผงรายละเอียดที่ Role นั้นใช้ · **ทุกตัวเลขมาจากข้อมูลจริง** (ระบบของเราเอง และ
 * สถานะจริงของกล่องจาก Server กลาง) ไม่มีตัวเลขตายตัว: metric ที่ยังไม่มีแหล่ง
 * ข้อมูลจริง (Reboot Loop, Firmware Suspended ฯลฯ) ไม่แสดง · สีใช้ semantic token
 * เท่านั้น
 *
 * hook ที่ใช้ร่วมหลายแผง (อุปกรณ์, Server กลาง, Rollout, Incident) เรียกที่นี่ครั้ง
 * เดียวแล้วส่งข้อมูลลงไป ไม่ให้แต่ละแผงยิงซ้ำ
 */

/** เกณฑ์ล้มเหลวที่ Rollout หยุดอัตโนมัติ (ดูข้อความสถานะ paused ใน
 *  lib/status-pill.ts: "ล้มเหลวเกิน 5%") — ใช้เป็นเกณฑ์เตือนที่ Dashboard ด้วย */
const FAILURE_WARN_PERCENT = 5;

export function DashboardSummary() {
  const { session } = useAuth();
  const role = session?.role;
  // FirmwareEngineer/QAEngineer ไม่มีสิทธิ์ `campaign:Read` (รีวิว #373) —
  // ข้ามการยิง `GET /campaigns*` ไปเลยแทนที่จะยิงแล้วได้ 403
  const hasCampaignAccess = canReadCampaign(role);
  const view = dashboardView(role);
  const me = session ? getTokenSubject(session.accessToken) : null;

  const devices = useDevices();
  const campaigns = useCampaigns(hasCampaignAccess);
  const pausedRollouts = usePausedCampaignRollouts(hasCampaignAccess);
  const allRollouts = useAllCampaignRollouts(hasCampaignAccess);
  const incidents = useIncidents();
  // สถานะจริงของกล่องจาก Server กลาง (ข้อมูลเสริม: ติดต่อไม่ได้ก็ไม่ทำให้แผงอื่นพัง)
  const central = useCentralDevices();
  const firmware = useFirmwareList(
    view.queue === "qa" || view.queue === "firmwareEngineer",
  );

  const deviceCount: number | null = devices.data ? devices.data.length : null;
  const pausedCount: number | null = pausedRollouts.data
    ? pausedRollouts.data.length
    : null;
  const incidentCount: number | null = incidents.data
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
  const deployTotal = deploy ? deploy.success + deploy.failed : 0;
  const successPercent =
    deploy && deployTotal > 0
      ? Math.round((deploy.success / deployTotal) * 100)
      : null;
  const failurePercent =
    deploy && deployTotal > 0 ? (deploy.failed / deployTotal) * 100 : 0;

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
  const connectionTotal = connectionSegments.reduce((n, s) => n + s.value, 0);
  const connectionLoading =
    centralLoading || (devices.data === null && devices.isLoading);
  const connectionEmpty = centralUnavailable
    ? "ติดต่อ Server กลางไม่ได้ตอนนี้ จึงยังไม่ทราบสถานะการเชื่อมต่อ"
    : "ยังไม่มีอุปกรณ์";

  // ---- แถวบนซ้าย: คิวงานของ Role (หรือกิจกรรมล่าสุดถ้า Role นี้ไม่มีคิว)
  const lead = (() => {
    switch (view.queue) {
      case "operation":
        return (
          <OperationQueue
            rollouts={allRollouts.data}
            pausedCount={pausedCount}
            incidentCount={incidentCount}
          />
        );
      case "field":
        return (
          <FieldQueue
            incidentCount={incidentCount}
            offlineCount={connection ? connection.offline : null}
            driftCount={driftCount}
            loading={connectionLoading && incidents.data === null}
          />
        );
      case "configEngineer":
        return <ConfigEngineerQueue me={me} />;
      case "qa":
      case "firmwareEngineer":
        return (
          <FirmwareQueue
            firmware={firmware.data}
            loading={firmware.isLoading}
            error={firmware.error}
            onRetry={() => void firmware.refetch()}
            role={view.queue === "qa" ? "QAEngineer" : "FirmwareEngineer"}
            me={me}
          />
        );
      default:
        return <DashboardActivity />;
    }
  })();

  // ---- แถวบนขวา: สถานะระบบ
  const healthRow: Record<HealthId, React.ReactNode> = {
    connection: (
      <HealthRow
        key="connection"
        label="การเชื่อมต่อ (Online / Offline)"
        value={connection ? connection.online : null}
        text={
          connection && connectionTotal > 0
            ? `${connection.online}/${connectionTotal}`
            : connectionLoading
              ? undefined
              : "-"
        }
        error={devices.error}
        href="/devices"
      >
        {!devices.error && !connectionLoading && (
          <div className="mt-2 pl-4.5">
            {connectionTotal === 0 ? (
              <p className="text-xs text-muted-foreground">{connectionEmpty}</p>
            ) : (
              <SegmentBar segments={connectionSegments} />
            )}
          </div>
        )}
      </HealthRow>
    ),
    offline: (
      <HealthRow
        key="offline"
        label="อุปกรณ์ออฟไลน์"
        value={connection ? connection.offline : null}
        error={devices.error}
        unavailable={centralUnavailable}
        attention="warning"
        href="/devices?connection=offline"
        hint="อุปกรณ์ในระบบที่ Server กลางรายงานว่าไม่ได้เชื่อมต่ออยู่"
      />
    ),
    drift: (
      <HealthRow
        key="drift"
        label="อุปกรณ์ที่ Config ยังไม่อัปเดต"
        value={driftCount}
        error={devices.error}
        unavailable={centralUnavailable}
        attention="warning"
        // ไม่ใส่ href: ยังไม่มีหน้าไหนกรองอุปกรณ์ตามเวอร์ชัน Config ที่ไม่ตรงได้
        hint="อุปกรณ์ที่รายงานเวอร์ชัน Config ไม่ตรงกับเวอร์ชันที่ตั้งเป้าไว้"
      />
    ),
    devices: (
      <HealthRow
        key="devices"
        label="อุปกรณ์ทั้งหมด"
        value={deviceCount}
        error={devices.error}
        href="/devices"
      />
    ),
    incident: (
      <HealthRow
        key="incident"
        label="Incident ที่ยังเปิดอยู่"
        value={incidentCount}
        error={incidents.error}
        attention="danger"
        href="/incidents"
        hint="Incident ที่สถานะเปิดอยู่หรือกำลังตรวจสอบ"
      />
    ),
    deploy: (
      <HealthRow
        key="deploy"
        label="ผลการ Deploy"
        value={successPercent}
        text={
          allRollouts.error
            ? undefined
            : allRollouts.data === null && allRollouts.isLoading
              ? undefined
              : deployTotal === 0
                ? "ยังไม่มีการ Deploy"
                : `${successPercent}%`
        }
        error={allRollouts.error}
        href="/campaigns"
      >
        {deployTotal > 0 && (
          <div className="mt-2 flex flex-col gap-2 pl-4.5">
            <SegmentBar segments={deploySegments} />
            {failurePercent >= FAILURE_WARN_PERCENT && (
              <p className="text-xs text-danger-foreground">
                ล้มเหลว {deploy?.failed} จาก {deployTotal} เครื่อง (
                {Math.round(failurePercent)}%) สูงกว่าเกณฑ์ {FAILURE_WARN_PERCENT}%
              </p>
            )}
          </div>
        )}
      </HealthRow>
    ),
  };
  const healthRows = view.health.filter(
    (id) => id !== "deploy" || hasCampaignAccess,
  );

  // ---- แผงรายละเอียดด้านล่าง
  const panel: Record<PanelId, React.ReactNode> = {
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
        central={central.data?.devices ?? null}
        loading={connectionLoading}
        error={devices.error}
        unavailable={centralUnavailable}
        onRetry={() => void devices.refetch?.()}
      />
    ),
    configStatus: <DashboardConfigStatusChart />,
    activity: <DashboardActivity />,
    firmwareStatus: (
      <DashboardFirmwareStatus
        firmware={firmware.data}
        loading={firmware.isLoading}
        error={firmware.error}
        onRetry={() => void firmware.refetch()}
      />
    ),
  };
  const rows = view.rows
    .map((row) => row.filter((p) => hasCampaignAccess || p.id !== "rollouts"))
    .filter((row) => row.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {centralIsMock && (
        <Notice tone="info">
          <strong>ข้อมูลตัวอย่าง</strong> สถานะการเชื่อมต่อและ Config
          ที่กล่องรายงานมาจาก Server กลางในโหมดจำลอง
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-12 [&>*>*]:h-full">
        <div className="lg:col-span-8">{lead}</div>
        <div className="lg:col-span-4">
          <HealthCard>{healthRows.map((id) => healthRow[id])}</HealthCard>
        </div>
      </div>

      {rows.map((row) => (
        <div
          key={row.map((p) => p.id).join("+")}
          className="grid gap-4 lg:grid-cols-12 [&>*>*]:h-full"
        >
          {row.map((p) => (
            // แถวที่เหลือ 1 แผง (เช่นตัดแผง Rollout ออก) ขยายเต็มความกว้าง
            <div key={p.id} className={spanClass(row.length === 1 ? 12 : p.span)}>
              {panel[p.id]}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
