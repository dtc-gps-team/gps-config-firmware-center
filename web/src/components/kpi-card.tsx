"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { StatusLed, type LedTone } from "@/components/ui/status-led";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { lift, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type KpiTone = "danger" | "warning" | "info" | "neutral";

/**
 * การ์ดตัวเลขที่กดแล้วไปหน้ารายการ — สองน้ำหนัก:
 * - `action` (ต้องลงมือทำ): ค่า > 0 เน้นสีสถานะ + LED เต้น, ค่า = 0 ลดน้ำหนัก
 *   เป็นสถานะปกติ (ตัวเลขจาง ไม่มีสี)
 * - `stat` (ตัวเลขนิ่ง): ไม่ใช้สี น้ำหนักต่ำเสมอ
 *
 * ลำดับสถานะ: error → unavailable (แหล่งข้อมูลติดต่อไม่ได้ ไม่โชว์ 0 ที่ดู
 * เหมือนปกติ) → loading → ค่า · `hint` คือคำอธิบายความหมายตัวเลขใน tooltip
 */
const TONE_LED: Record<KpiTone, LedTone> = {
  danger: "danger",
  warning: "warning",
  info: "info",
  neutral: "neutral",
};

const TONE_ACTIVE: Record<KpiTone, string> = {
  danger: "bg-danger-subtle ring-destructive/40 hover:ring-destructive/70",
  warning: "bg-warning-subtle ring-warning/50 hover:ring-warning",
  info: "bg-info-subtle ring-info/40 hover:ring-info/70",
  neutral: "bg-card ring-foreground/20 hover:ring-foreground/40",
};

const TONE_PLAIN_ACTIVE: Record<KpiTone, string> = {
  danger: "bg-danger-subtle hover:brightness-[0.98]",
  warning: "bg-warning-subtle hover:brightness-[0.98]",
  info: "bg-info-subtle hover:brightness-[0.98]",
  neutral: "bg-card hover:bg-muted/60",
};

const TONE_VALUE: Record<KpiTone, string> = {
  danger: "text-danger-foreground",
  warning: "text-warning-foreground",
  info: "text-info-foreground",
  neutral: "text-foreground",
};

export function KpiCard({
  label,
  href,
  value,
  error,
  tone = "neutral",
  emphasis = "stat",
  hint,
  unavailable = false,
  plain = false,
  className,
}: {
  label: string;
  /** ไม่ใส่ = การ์ดไม่กดได้ (ไม่มีหน้าปลายทางที่ตรงกับตัวเลขนี้จริง) */
  href?: string;
  /** null = ยังโหลดอยู่ */
  value: number | null;
  error: string | null;
  tone?: KpiTone;
  emphasis?: "action" | "stat";
  hint?: string;
  /** แหล่งข้อมูลติดต่อไม่ได้ (เช่น Server กลาง) แสดง "ไม่ทราบ" ไม่ใช่เลข 0 */
  unavailable?: boolean;
  /** ไม่มีกรอบของตัวเอง ใช้เป็นช่องในแถบที่ครอบด้วย Card เดียว */
  plain?: boolean;
  className?: string;
}) {
  const active = emphasis === "action" && value !== null && value > 0 && !error && !unavailable;
  const calm = emphasis === "action" && value === 0 && !error && !unavailable;

  const common = {
    "data-slot": "kpi-card",
    "data-active": active || undefined,
  };
  const rawSurfaceClass = cn(

        "group/kpi flex h-full min-w-0 flex-col gap-2 rounded-lg px-4 py-3.5 ring-1 transition-[box-shadow,background-color] duration-(--duration-base) ease-(--ease-standard) outline-none focus-visible:ring-2 focus-visible:ring-ring",
        plain
          ? cn(
              "rounded-none px-5 py-4 ring-0 focus-visible:ring-inset",
              active ? TONE_PLAIN_ACTIVE[tone] : "bg-card hover:bg-muted/60",
            )
          : active
            ? TONE_ACTIVE[tone]
            : "bg-card ring-foreground/20 hover:ring-foreground/40",
      
  );
  // ไม่ใช่ลิงก์ = ไม่มีอาการ hover (ไม่หลอกว่ากดได้)
  const surfaceClass = href
    ? rawSurfaceClass
    : rawSurfaceClass.replace(/hover:\S+/g, "");
  const inner = (
    <>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {emphasis === "action" && !error && !unavailable && value !== null && (
          <StatusLed
            tone={active ? TONE_LED[tone] : "online"}
            pulse={active}
          />
        )}
        <span className={cn(active && "font-medium text-foreground/80")}>
          {label}
        </span>
      </span>
      <span
        data-tabular
        className={cn(
          "font-semibold tracking-tight tabular-nums",
          "text-3xl",
          active ? TONE_VALUE[tone] : calm ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {error ? (
          <span className="text-base font-normal text-destructive">
            โหลดไม่สำเร็จ
          </span>
        ) : unavailable ? (
          <span className="text-base font-normal text-muted-foreground">
            ไม่ทราบ
          </span>
        ) : value === null ? (
          <Skeleton className="mt-1 h-8 w-14" />
        ) : (
          value.toLocaleString("th-TH")
        )}
      </span>
      {calm && <span className="text-xs text-muted-foreground">ปกติ</span>}
    </>
  );
  const card = href ? (
    <Link href={href} {...common} className={surfaceClass}>
      {inner}
    </Link>
  ) : (
    <div {...common} className={surfaceClass}>
      {inner}
    </div>
  );

  return (
    <motion.div
      whileHover={plain || !href ? undefined : lift}
      transition={transition.fast}
      className={cn("min-w-0", className)}
    >
      {hint ? (
        <Tooltip>
          <TooltipTrigger render={card} />
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      ) : (
        card
      )}
    </motion.div>
  );
}
