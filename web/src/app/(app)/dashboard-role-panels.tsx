"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { ErrorState } from "@/components/error-state";
import { RelativeTime } from "@/components/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfigs } from "@/hooks/use-configs";
import { useFirmwareList } from "@/hooks/use-firmware";
import { getTokenSubject } from "@/lib/jwt";
import {
  CONFIG_STATUS_TONE,
  FIRMWARE_APPROVAL_STATUS_TONE,
  StatusPill,
  statusLabel,
} from "@/lib/status-pill";
import {
  spanClass,
  type FocusPanelId,
  type PanelSpan,
} from "@/lib/dashboard-view";
import { DashboardActivity } from "./dashboard-activity";
import { DashboardConfigStatusChart } from "./dashboard-config-status-chart";
import { Panel, PanelEmpty } from "./dashboard-panel";

const MAX_ROWS = 6;

/** ลำดับความเร่งด่วนของ Config ของฉัน: ถูกปฏิเสธต้องแก้ก่อน, draft ยังไม่ส่ง,
 *  testing รอผู้อนุมัติ (ไม่ต้องทำอะไร) */
const MY_CONFIG_ORDER: Record<string, number> = {
  rejected: 0,
  draft: 1,
  testing: 2,
};

/** Config ที่ฉัน (ConfigEngineer) สร้างและยังไม่จบ — ตอบ "มีอะไรค้างอยู่ในมือฉัน" */
function MyConfigsPanel({ className }: { className?: string }) {
  const { session } = useAuth();
  const { data, isLoading, error, refetch } = useConfigs();
  const me = session ? getTokenSubject(session.accessToken) : null;

  const mine = useMemo(
    () =>
      (data ?? [])
        .filter((c) => c.createdBy === me && c.status in MY_CONFIG_ORDER)
        .sort(
          (a, b) =>
            MY_CONFIG_ORDER[a.status] - MY_CONFIG_ORDER[b.status] ||
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [data, me],
  );
  const rejected = mine.filter((c) => c.status === "rejected").length;

  return (
    <Panel
      title="Config ของฉันที่ยังไม่จบ"
      href="/config"
      description={
        mine.length > 0
          ? `${mine.length.toLocaleString("th-TH")} รายการ${rejected > 0 ? ` ถูกปฏิเสธ ${rejected} ต้องแก้ไข` : ""}`
          : undefined
      }
      className={className}
    >
      {error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : isLoading && data === null ? (
        <Skeleton className="h-16 w-full" />
      ) : mine.length === 0 ? (
        <PanelEmpty>ไม่มี Config ค้างอยู่ในมือคุณ</PanelEmpty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {mine.slice(0, MAX_ROWS).map((c) => (
            <li key={c.id}>
              <Link
                href={`/config/${c.id}`}
                className="flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <StatusPill tone={CONFIG_STATUS_TONE[c.status] ?? "neutral"}>
                  {statusLabel(c.status)}
                </StatusPill>
                <RelativeTime
                  iso={c.updatedAt}
                  className="w-24 text-right text-xs text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * คิว Firmware: QAEngineer เห็นทุกตัวที่รอตรวจคุณภาพ, FirmwareEngineer เห็นเฉพาะ
 * ที่ตัวเองอัปโหลดและยังรอตรวจหรือถูกปฏิเสธ — กรองฝั่งหน้าจอจากรายการเดียวกับที่
 * หน้า Firmware Repository ใช้ (`GET /firmware`)
 */
function FirmwareQueuePanel({ className }: { className?: string }) {
  const { session } = useAuth();
  const { data, isLoading, error, refetch } = useFirmwareList();
  const role = session?.role;
  const me = session ? getTokenSubject(session.accessToken) : null;
  const isQa = role === "QAEngineer";

  const queue = useMemo(
    () =>
      (data ?? [])
        .filter((f) =>
          isQa
            ? f.approvalStatus === "pending_review"
            : f.uploadedBy === me &&
              (f.approvalStatus === "pending_review" ||
                f.approvalStatus === "rejected"),
        )
        .sort(
          (a, b) =>
            new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime(),
        ),
    [data, isQa, me],
  );

  return (
    <Panel
      title={isQa ? "Firmware ที่รอตรวจคุณภาพ" : "Firmware ของฉันที่ยังไม่ผ่าน"}
      href="/firmware"
      description={
        queue.length > 0
          ? `${queue.length.toLocaleString("th-TH")} รายการ ${isQa ? "ค้างนานสุดก่อน" : ""}`.trim()
          : undefined
      }
      className={className}
    >
      {error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : isLoading && data === null ? (
        <Skeleton className="h-16 w-full" />
      ) : queue.length === 0 ? (
        <PanelEmpty>
          {isQa ? "ไม่มี Firmware ที่รอตรวจ" : "ไม่มี Firmware ที่ค้างหรือถูกปฏิเสธ"}
        </PanelEmpty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {queue.slice(0, MAX_ROWS).map((f) => (
            <li key={f.id}>
              <Link
                href={`/firmware/${f.id}`}
                className="flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-muted/60"
              >
                <span className="font-instrument min-w-0 flex-1 truncate">
                  {f.version}
                </span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">
                  {f.deviceModelCompatibility.join(", ")}
                </span>
                <StatusPill
                  tone={FIRMWARE_APPROVAL_STATUS_TONE[f.approvalStatus] ?? "neutral"}
                >
                  {statusLabel(f.approvalStatus)}
                </StatusPill>
                <RelativeTime
                  iso={f.uploadedAt}
                  className="w-24 text-right text-xs text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PanelById({ id }: { id: FocusPanelId }) {
  switch (id) {
    case "myConfigs":
      return <MyConfigsPanel />;
    case "firmwareQueue":
      return <FirmwareQueuePanel />;
    case "configStatus":
      return <DashboardConfigStatusChart />;
    case "activity":
      return <DashboardActivity />;
  }
}

/** แถวแผงตามมุมมองของ Role (ใช้ทั้งแถวบนและท้ายหน้า) — แผงในแถวสูงเท่ากัน */
export function DashboardPanelRow({
  panels,
}: {
  panels: { id: FocusPanelId; span: PanelSpan }[];
}) {
  if (panels.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-12 [&>*>*]:h-full">
      {panels.map((p) => (
        <div key={p.id} className={spanClass(p.span)}>
          <PanelById id={p.id} />
        </div>
      ))}
    </div>
  );
}
