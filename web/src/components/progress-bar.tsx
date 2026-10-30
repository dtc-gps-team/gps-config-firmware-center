"use client";

import { motion } from "motion/react";

import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * แถบความคืบหน้า 0-100 (animate ด้วย transform ไม่ใช่ width) · มี role=progressbar
 * พร้อมค่าสำหรับโปรแกรมอ่านหน้าจอ · `tone="danger"` เมื่อล้มเหลว
 */
export function ProgressBar({
  value,
  label,
  tone = "default",
  className,
}: {
  value: number;
  label: string;
  tone?: "default" | "danger";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
    >
      <motion.div
        className={cn(
          "h-full origin-left rounded-full",
          tone === "danger" ? "bg-destructive" : "bg-primary",
        )}
        initial={false}
        animate={{ scaleX: pct / 100 }}
        transition={transition.base}
      />
    </div>
  );
}
