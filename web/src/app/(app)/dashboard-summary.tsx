"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BoxIcon,
  ClockIcon,
  RocketIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConfigs } from "@/hooks/use-configs";
import { useDevices } from "@/hooks/use-devices";
import { useCampaigns } from "@/hooks/use-campaigns";
import { usePausedCampaignRollouts } from "@/hooks/use-paused-campaign-rollouts";
import { DEMO_DEVICE_OVERVIEW, DEMO_RISK_DASHBOARD } from "@/lib/demo-data";
import { toneColorClass, type PillTone } from "@/lib/status-pill";

/**
 * Dashboard — จัดเป็น 3 กลุ่มตาม docs/planning §12.1 (Device Overview /
 * Deployment Overview / Risk Dashboard) — Customer Priority กับ Capacity
 * ไม่มีในนี้ตั้งใจ (ดู comment ที่ demo-data.ts): Customer Priority ไม่เคย
 * ถูกออกแบบไว้ในระบบนี้เลย (ไม่มี field/RBAC รองรับ), Capacity เป็น infra
 * metric ของ config-sync-writer ที่ตัดออกจาก scope งาน A แล้ว
 *
 * แต่ละกลุ่มผสมการ์ดจริง (ต่อ API แล้ว, มี href คลิกไปหน้าที่เกี่ยวข้องได้) กับ
 * การ์ดตัวอย่าง (มี badge "ตัวอย่าง" กำกับชัดเจน — รอ backend module ที่ยัง
 * ไม่ตัดสินใจ ไม่ใช่ของปลอมที่แกล้งทำเหมือนของจริง)
 *
 * icon badge มุมขวาบน — เทียบกับ mockup UX/UI Design ต้นฉบับที่มี icon badge
 * สีต่างกันทุกการ์ดสรุป แต่ของจริงเป็น label+ตัวเลขเปล่าๆ มาตลอด สีของ badge
 * ใช้ชุดสีเดียวกับ StatusPill (toneColorClass) ไม่คิดสีชุดใหม่แยก
 */
function CardIconBadge({ icon: Icon, tone }: { icon: LucideIcon; tone: PillTone }) {
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
}: {
  label: string;
  href: string;
  /** null = ยังโหลดอยู่ */
  value: number | null;
  error: string | null;
  icon: LucideIcon;
  tone: PillTone;
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

function DemoSummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: PillTone;
}) {
  return (
    <Card className="h-full border border-dashed border-amber-300/60 shadow-none dark:border-amber-800/50">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {label}
          <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            ตัวอย่าง
          </span>
        </CardDescription>
        <CardTitle className="text-3xl tabular-nums text-muted-foreground">
          {value}
        </CardTitle>
        <CardAction>
          <CardIconBadge icon={icon} tone={tone} />
        </CardAction>
      </CardHeader>
    </Card>
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
 * การ์ดมินิชาร์ต stacked bar แนวนอน — ใช้แทนการ์ดตัวเลขเดี่ยวๆ หลายใบที่เป็น
 * ข้อมูล part-to-whole เดียวกัน (Online/Offline, สำเร็จ/ล้มเหลว/Rollback)
 * เพื่อลดจำนวนการ์ดสี่เหลี่ยมและใช้พื้นที่คุ้มขึ้น (feedback A 2026-10-07 —
 * การ์ดเดี่ยวๆ เยอะเกินไปเมื่อเทียบกับการ์ด Config status chart ที่มีอยู่แล้ว)
 * — ยังเป็นข้อมูลตัวอย่าง (badge "ตัวอย่าง" เหมือน `DemoSummaryCard`) ไม่ใช่
 * ของจริง ต่างจาก `DashboardConfigStatusChart` ที่ต่อ API แล้ว
 */
function MiniStackedBarCard({
  label,
  segments,
}: {
  label: string;
  segments: MiniBarSegment[];
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card className="col-span-2 h-full border border-dashed border-amber-300/60 shadow-none dark:border-amber-800/50">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {label}
          <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            ตัวอย่าง
          </span>
        </CardDescription>
      </CardHeader>
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
                    <span className="font-semibold tabular-nums">{s.value}</span>{" "}
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
              <span className={`size-2.5 shrink-0 rounded-sm ${s.colorClass}`} />
              <dt className="text-muted-foreground">{s.label}</dt>
              <dd className="font-medium tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
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
const ONLINE_OFFLINE_SEGMENTS: MiniBarSegment[] = [
  { key: "online", label: "Online", value: 142, colorClass: "bg-[#008300] dark:bg-[#008300]" },
  { key: "offline", label: "Offline", value: 8, colorClass: "bg-[#e34948] dark:bg-[#e66767]" },
];

const DEPLOY_RESULT_SEGMENTS: MiniBarSegment[] = [
  { key: "success", label: "สำเร็จ", value: 128, colorClass: "bg-[#008300] dark:bg-[#008300]" },
  { key: "failed", label: "ล้มเหลว", value: 4, colorClass: "bg-[#e34948] dark:bg-[#e66767]" },
  { key: "rollback", label: "Rollback", value: 1, colorClass: "bg-[#2a78d6] dark:bg-[#3987e5]" },
];

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
  const devices = useDevices();
  const configs = useConfigs();
  const campaigns = useCampaigns();
  const pausedRollouts = usePausedCampaignRollouts();

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
          <LiveSummaryCard
            label="Rollout หยุดชั่วคราว (Auto Pause)"
            href="/campaigns"
            value={pausedRolloutCount}
            error={pausedRollouts.error}
            icon={TriangleAlertIcon}
            tone="danger"
          />
          {DEMO_RISK_DASHBOARD.map((card) => (
            <DemoSummaryCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={card.icon}
              tone={card.tone}
            />
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="ภาพรวมการ Deploy" description="Deployment Overview">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <LiveSummaryCard
            label="Config รออนุมัติ"
            href="/approvals"
            value={pendingConfigCount}
            error={configs.error}
            icon={ClockIcon}
            tone="progress"
          />
          <LiveSummaryCard
            label="กลุ่มอุปกรณ์ทั้งหมด"
            href="/campaigns"
            value={campaignCount}
            error={campaigns.error}
            icon={RocketIcon}
            tone="progress"
          />
          <MiniStackedBarCard label="ผลการ Deploy" segments={DEPLOY_RESULT_SEGMENTS} />
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
            label="รุ่นอุปกรณ์"
            href="/devices"
            value={modelCount}
            error={devices.error}
            icon={SlidersHorizontalIcon}
            tone="neutral"
          />
          <MiniStackedBarCard label="Online / Offline" segments={ONLINE_OFFLINE_SEGMENTS} />
          {DEMO_DEVICE_OVERVIEW.map((card) => (
            <DemoSummaryCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={card.icon}
              tone={card.tone}
            />
          ))}
        </div>
      </DashboardSection>
    </div>
  );
}
