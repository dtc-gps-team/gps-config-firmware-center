"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BoxIcon, ClockIcon, type LucideIcon } from "lucide-react";

import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConfigs } from "@/hooks/use-configs";
import { useDevices } from "@/hooks/use-devices";
import { DEMO_DASHBOARD_SUMMARY } from "@/lib/demo-data";
import { toneColorClass, type PillTone } from "@/lib/status-pill";

/**
 * การ์ดสรุปบน Dashboard — 2 ใบต่อ API จริงแล้ว (`GET /devices`,
 * `GET /config`) · อีก 2 ใบ (Campaign / Incident) ยังเป็นตัวอย่าง
 * รอ endpoint ใน Sprint ถัดไป — ดู DEMO_DASHBOARD_SUMMARY
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

export function DashboardSummary() {
  const devices = useDevices();
  const configs = useConfigs();

  const deviceCount: number | null = devices.data ? devices.data.length : null;
  const pendingConfigCount: number | null = useMemo(
    () =>
      configs.data
        ? configs.data.filter((c) => c.status === "testing").length
        : null,
    [configs.data],
  );

  return (
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
        label="Config รออนุมัติ"
        href="/config"
        value={pendingConfigCount}
        error={configs.error}
        icon={ClockIcon}
        tone="progress"
      />
      {DEMO_DASHBOARD_SUMMARY.map((card) => (
        <DemoSummaryCard
          key={card.label}
          label={card.label}
          value={card.value}
          icon={card.icon}
          tone={card.tone}
        />
      ))}
    </div>
  );
}
