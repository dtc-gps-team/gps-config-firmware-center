"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  BoxIcon,
  ClockIcon,
  RocketIcon,
  SlidersHorizontalIcon,
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
import {
  DEMO_DEPLOYMENT_OVERVIEW,
  DEMO_DEVICE_OVERVIEW,
  DEMO_RISK_DASHBOARD,
} from "@/lib/demo-data";
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
      <Card className="h-full transition-colors hover:bg-muted/50">
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
    <Card className="h-full">
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
  const activeCampaignCount: number | null = useMemo(
    () =>
      campaigns.data
        ? campaigns.data.filter((c) => c.status === "active").length
        : null,
    [campaigns.data],
  );
  const pendingCampaignCount: number | null = useMemo(
    () =>
      campaigns.data
        ? campaigns.data.filter((c) => c.status === "pending_approval").length
        : null,
    [campaigns.data],
  );

  return (
    <div className="flex flex-col gap-8">
      <DashboardSection title="ภาพรวมอุปกรณ์" description="Device Overview">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <DashboardSection title="ภาพรวมการ Deploy" description="Deployment Overview">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LiveSummaryCard
            label="Config รออนุมัติ"
            href="/approvals"
            value={pendingConfigCount}
            error={configs.error}
            icon={ClockIcon}
            tone="progress"
          />
          <LiveSummaryCard
            label="Campaign กำลังทำงาน"
            href="/campaigns"
            value={activeCampaignCount}
            error={campaigns.error}
            icon={RocketIcon}
            tone="progress"
          />
          <LiveSummaryCard
            label="Campaign รออนุมัติ"
            href="/campaigns"
            value={pendingCampaignCount}
            error={campaigns.error}
            icon={ClockIcon}
            tone="progress"
          />
          {DEMO_DEPLOYMENT_OVERVIEW.map((card) => (
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

      <DashboardSection title="ความเสี่ยง" description="Risk Dashboard">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
    </div>
  );
}
