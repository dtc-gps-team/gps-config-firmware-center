"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertOctagonIcon,
  BoxIcon,
  ClockIcon,
  GitCompareIcon,
  RocketIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";
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
import { canReadCampaign } from "@/lib/permissions";
import { toneColorClass, type PillTone } from "@/lib/status-pill";

/**
 * Dashboard — จัดเป็น 3 กลุ่มตาม docs/planning §12.1 (Device Overview /
 * Deployment Overview / Risk Dashboard) · **ทุกตัวเลขมาจากข้อมูลจริง** (ระบบของเราเอง และสถานะ
 * จริงของกล่องจาก Server กลาง) ไม่มีตัวเลขตายตัว: metric ที่ยังไม่มีแหล่งข้อมูลจริง (Reboot
 * Loop, Firmware Suspended ฯลฯ) ไม่แสดง แทนที่จะแสดงตัวเลขตัวอย่าง
 *
 * icon badge มุมขวาบนใช้ชุดสีเดียวกับ StatusPill (toneColorClass)
 */
function CardIconBadge({
  icon: Icon,
  tone,
}: {
  icon: LucideIcon;
  tone: PillTone;
}) {
  return (
    <div
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneColorClass(tone)}`}
    >
      <Icon className="size-4.5" />
    </div>
  );
}

function LiveSummaryCard({
  label,
  href,
  value,
  error,
  icon,
  tone,
  unavailable = false,
}: {
  label: string;
  href: string;
  /** null = ยังโหลดอยู่ */
  value: number | null;
  error: string | null;
  icon: LucideIcon;
  tone: PillTone;
  /** แหล่งข้อมูลติดต่อไม่ได้ (เช่น Server กลาง) แสดง "ไม่ทราบ" ไม่ใช่เลข 0 ที่ดูเหมือนปกติ */
  unavailable?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Card interactive className="h-full">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {error ? (
              <span className="text-base font-normal text-destructive">
                โหลดไม่สำเร็จ
              </span>
            ) : unavailable ? (
              <span
                className="text-base font-normal text-muted-foreground"
                title="ติดต่อ Server กลางไม่ได้ตอนนี้"
              >
                ไม่ทราบ
              </span>
            ) : value === null ? (
              <span className="text-muted-foreground">…</span>
            ) : (
              value.toLocaleString("th-TH")
            )}
          </CardTitle>
          <CardAction>
            <CardIconBadge icon={icon} tone={tone} />
          </CardAction>
        </CardHeader>
      </Card>
    </Link>
  );
}

type MiniBarSegment = {
  key: string;
  label: string;
  value: number;
  /** สีที่ผ่าน dataviz skill validator แล้ว (ดู comment เหนือ
   * `ONLINE_OFFLINE_SEGMENTS`/`DEPLOY_RESULT_SEGMENTS`) — คนละชุดกับ
   * `PillTone` ที่ใช้ทั่วแอปโดยตั้งใจ เหมือนกับที่ `DashboardConfigStatusChart`
   * ทำไว้ก่อนแล้ว */
  colorClass: string;
};

/** ขนาดขั้นต่ำ (% ของความกว้างทั้งแท่ง) ที่ segment จะโชว์ตัวเลขในตัวเอง —
 * แคบกว่านี้ให้พึ่ง legend/tooltip แทน (กันตัวเลขล้นออกนอก segment) mirror
 * `DashboardConfigStatusChart` */
const MINI_BAR_INLINE_LABEL_MIN_PERCENT = 12;

/**
 * การ์ดมินิชาร์ต stacked bar แนวนอน — ใช้แทนการ์ดตัวเลขเดี่ยวๆ หลายใบที่เป็นข้อมูล
 * part-to-whole เดียวกัน (ออนไลน์/ออฟไลน์/ไม่ทราบ, สำเร็จ/ล้มเหลว) · `segments` มาจากข้อมูลจริง
 * · `value` เป็น null = ยังโหลดอยู่ · รวมเป็น 0 = ยังไม่มีข้อมูลให้แสดงสัดส่วน (บอกตรงๆ ไม่วาดแท่งเปล่า)
 */
function MiniStackedBarCard({
  label,
  href,
  segments,
  loading,
  error,
  emptyText,
  badge,
}: {
  label: string;
  href: string;
  segments: MiniBarSegment[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  /** ป้ายเล็กข้างหัวข้อ เช่น "ข้อมูลตัวอย่าง" เมื่อแหล่งข้อมูลอยู่ในโหมด mock */
  badge?: string | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card className="col-span-2 h-full">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Link href={href} className="hover:underline">
            {label}
          </Link>
          {badge && (
            <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {badge}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      {error ? (
        <p className="px-6 pb-5 text-sm text-destructive">โหลดไม่สำเร็จ</p>
      ) : loading ? (
        <div className="px-6 pb-5">
          <div className="h-5 w-full animate-pulse rounded bg-muted" />
        </div>
      ) : total === 0 ? (
        <p className="px-6 pb-5 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-2 px-6 pb-5">
          <div className="mt-1 flex h-5 w-full gap-0.5">
            {segments.map((s, i) => {
              const percent = total > 0 ? (s.value / total) * 100 : 0;
              const isFirst = i === 0;
              const isLast = i === segments.length - 1;
              return (
                <button
                  key={s.key}
                  type="button"
                  className={[
                    "group relative flex items-center justify-center transition-[filter] outline-none",
                    s.colorClass,
                    isFirst ? "rounded-l" : "",
                    isLast ? "rounded-r" : "",
                    hovered === s.key ? "brightness-110" : "",
                  ].join(" ")}
                  style={{ width: `${percent}%` }}
                  onMouseEnter={() => setHovered(s.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(s.key)}
                  onBlur={() => setHovered(null)}
                >
                  {percent >= MINI_BAR_INLINE_LABEL_MIN_PERCENT && (
                    <span className="text-[#0b0b0b] text-xs font-medium tabular-nums">
                      {s.value}
                    </span>
                  )}
                  {hovered === s.key && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10">
                      <span className="font-semibold tabular-nums">
                        {s.value}
                      </span>{" "}
                      <span className="text-muted-foreground">{s.label}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`size-2.5 shrink-0 rounded-sm ${s.colorClass}`}
                />
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className="font-medium tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Card>
  );
}

/** สีผ่าน dataviz validator แล้ว (`node scripts/validate_palette.js`) —
 * เลือก green/red/blue เพราะข้อมูลสื่อ "ดี/แย่/แก้ไขแล้ว" โดยธรรมชาติ ไม่ใช่
 * สถานะ (status palette) เพราะเป็นแท่งหลายส่วนเทียบกัน (part-to-whole) ไม่ใช่
 * badge เดี่ยว — status palette สงวนไว้สำหรับ badge+icon+label เท่านั้นตาม
 * dataviz skill ไม่ใช่ fill ของแท่งที่ต้องแยกจากกันเอง: green vs red ผ่าน
 * all-checks มี WARN เดียว (CVD 6-8 band, light mode) ซึ่งชดเชยด้วย legend +
 * ตัวเลขในแท่ง (secondary encoding) ตามกฎของ skill
 */
const GREEN = "bg-[#008300] dark:bg-[#008300]";
const RED = "bg-[#e34948] dark:bg-[#e66767]";
const GREY = "bg-[#8b95a5] dark:bg-[#6b7686]";

function DashboardSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

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
  // แก้ไข 2026-09-24 (Campaign Monitor #22 — แยกกลุ่มออกจากรอบ push):
  // `Campaign` (กลุ่ม) ไม่มี `status` อีกต่อไป (ย้ายไปอยู่ที่
  // `CampaignRollout` แทน) เดิมการ์ดนี้นับ active/pending_approval จาก
  // status ของ Campaign ตรงๆ — ยังไม่มี endpoint รวม Rollout ข้ามทุกกลุ่ม
  // ให้นับแบบเดิมได้ จึงเหลือแค่จำนวนกลุ่มทั้งหมดไปก่อน
  const campaignCount: number | null = campaigns.data
    ? campaigns.data.length
    : null;
  // #238 review comment ข้อ 6 — นับจำนวน "Rollout ที่ paused" (นับเป็นกลุ่ม
  // ไม่ใช่รายเครื่อง) ไม่ใช่ "จำนวนเครื่องที่ Failure" คนละ metric กับที่
  // label เดิม ("Failure สูง") สื่อ — ดู label การ์ดด้านล่างที่แก้ตาม
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
  const centralBadge = central.data?.mode === "mock" ? "ข้อมูลตัวอย่าง" : null;

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
  const connectionSegments: MiniBarSegment[] = connection
    ? [
        {
          key: "online",
          label: "ออนไลน์",
          value: connection.online,
          colorClass: GREEN,
        },
        {
          key: "offline",
          label: "ออฟไลน์",
          value: connection.offline,
          colorClass: RED,
        },
        {
          key: "unknown",
          label: "ไม่ทราบ",
          value: connection.unknown,
          colorClass: GREY,
        },
      ]
    : [];
  const deploySegments: MiniBarSegment[] = deploy
    ? [
        {
          key: "success",
          label: "สำเร็จ",
          value: deploy.success,
          colorClass: GREEN,
        },
        {
          key: "failed",
          label: "ล้มเหลว",
          value: deploy.failed,
          colorClass: RED,
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-8">
      {/* ความเสี่ยงขึ้นก่อน Device/Deployment Overview โดยตั้งใจ (แก้ครั้งที่
       * 73) — ของที่ต้อง action (risk/alert) ควรอยู่ในลำดับการกวาดสายตาแรกๆ
       * (F-pattern) ไม่ใช่ตัวเลขนิ่งๆ อย่างจำนวนอุปกรณ์/รุ่นที่แทบไม่เปลี่ยน
       * ที่เคยอยู่บนสุด */}
      <DashboardSection title="ความเสี่ยง" description="Risk Dashboard">
        {/* grid คงที่ 4 คอลัมน์ (2 คอลัมน์บนจอแคบ) แทน auto-fit เดิม — การ์ด
         * ตัวเลขเดี่ยวกิน 1 ช่อง การ์ดมินิชาร์ตกิน 2 ช่องเสมอ ไม่ปล่อยให้
         * เบราว์เซอร์คำนวณความกว้างจากพื้นที่เหลือแบบสุ่มอีกต่อไป (แก้ครั้งที่
         * 73 — เดิมการ์ดจะกว้าง/แคบต่างกันตามพื้นที่เหลือ ไม่สื่อความสำคัญ) */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {hasCampaignAccess && (
            <LiveSummaryCard
              label="Rollout หยุดชั่วคราว (Auto Pause)"
              href="/campaigns"
              value={pausedRolloutCount}
              error={pausedRollouts.error}
              icon={TriangleAlertIcon}
              tone="danger"
            />
          )}
          <LiveSummaryCard
            label="Incident ที่ยังต้องตาม"
            href="/incidents"
            value={activeIncidents}
            error={incidents.error}
            icon={AlertOctagonIcon}
            tone="danger"
          />
          <LiveSummaryCard
            label="อุปกรณ์ออฟไลน์"
            href="/devices"
            value={connection ? connection.offline : null}
            error={devices.error}
            unavailable={centralUnavailable}
            icon={WifiOffIcon}
            tone="danger"
          />
          <LiveSummaryCard
            label="Config ไม่ตรงกับที่ตั้งไว้"
            href="/devices"
            value={driftCount}
            error={devices.error}
            unavailable={centralUnavailable}
            icon={GitCompareIcon}
            tone="progress"
          />
        </div>
      </DashboardSection>

      <DashboardSection
        title="ภาพรวมการ Deploy"
        description="Deployment Overview"
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <LiveSummaryCard
            label="Config รออนุมัติ"
            href="/approvals"
            value={pendingConfigCount}
            error={configs.error}
            icon={ClockIcon}
            tone="progress"
          />
          {hasCampaignAccess && (
            <LiveSummaryCard
              label="กลุ่มอุปกรณ์ทั้งหมด"
              href="/campaigns"
              value={campaignCount}
              error={campaigns.error}
              icon={RocketIcon}
              tone="progress"
            />
          )}
          {hasCampaignAccess && (
            <MiniStackedBarCard
              label="ผลการ Deploy"
              href="/campaigns"
              segments={deploySegments}
              loading={allRollouts.data === null && allRollouts.isLoading}
              error={allRollouts.error}
              emptyText="ยังไม่มีการ Deploy"
            />
          )}
        </div>
      </DashboardSection>

      <DashboardSection title="ภาพรวมอุปกรณ์" description="Device Overview">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <LiveSummaryCard
            label="อุปกรณ์ทั้งหมด"
            href="/devices"
            value={deviceCount}
            error={devices.error}
            icon={BoxIcon}
            tone="neutral"
          />
          <LiveSummaryCard
            label="โมเดล"
            href="/devices"
            value={modelCount}
            error={devices.error}
            icon={SlidersHorizontalIcon}
            tone="neutral"
          />
          <MiniStackedBarCard
            label="การเชื่อมต่อ (Online / Offline)"
            href="/devices"
            segments={connectionSegments}
            loading={
              centralLoading || (devices.data === null && devices.isLoading)
            }
            error={devices.error}
            emptyText={
              centralUnavailable
                ? "ติดต่อ Server กลางไม่ได้ตอนนี้ จึงยังไม่ทราบสถานะการเชื่อมต่อ"
                : "ยังไม่มีอุปกรณ์"
            }
            badge={centralBadge}
          />
        </div>
      </DashboardSection>
    </div>
  );
}
