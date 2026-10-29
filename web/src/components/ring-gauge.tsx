"use client";

import { motion, useReducedMotion } from "motion/react";

import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type RingSegment = {
  key: string;
  label: string;
  value: number;
  /** คลาส stroke ของสี (token เท่านั้น เช่น `stroke-success`) */
  strokeClass: string;
};

const RADIUS = 42;
/** ช่องว่างระหว่างส่วน (สัดส่วนของเส้นรอบวง) */
const GAP = 0.012;

/**
 * วงแหวนแสดงสัดส่วน (part-to-whole) — แต่ละส่วนวาดเป็นส่วนโค้งที่ยืดออกจาก 0
 * ตอนโหลด (ข้ามเมื่อ prefers-reduced-motion) · ตรงกลางใส่ตัวเลขหลักผ่าน
 * `children` · ไม่มีข้อมูล (ผลรวม 0) วาดรางว่างอย่างเดียว · `label` อ่านโดย
 * screen reader เป็นข้อความสรุปค่าทั้งหมด
 */
export function RingGauge({
  segments,
  size = 128,
  thickness = 9,
  label,
  className,
  children,
}: {
  segments: RingSegment[];
  size?: number;
  thickness?: number;
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const total = segments.reduce((n, s) => n + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  const gap = visible.length > 1 ? GAP : 0;
  const arcs = visible.map((s, i) => {
    const before = visible.slice(0, i).reduce((n, v) => n + v.value, 0);
    return {
      ...s,
      start: total > 0 ? before / total : 0,
      length: Math.max((total > 0 ? s.value / total : 0) - gap, 0.001),
    };
  });

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth={thickness}
          className="stroke-muted"
        />
        {arcs.map((arc, i) => (
          <motion.circle
            key={arc.key}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth={thickness}
            pathLength={1}
            strokeDashoffset={-arc.start}
            className={cn(
              arc.strokeClass,
              "transition-[stroke-dashoffset] duration-(--duration-slow)",
            )}
            initial={reduce ? false : { strokeDasharray: "0 1" }}
            animate={{ strokeDasharray: `${arc.length} ${1 - arc.length}` }}
            transition={{
              duration: duration.slow / 1000 + 0.2,
              ease: ease.emphasizedOut,
              delay: reduce ? 0 : i * 0.08,
            }}
          />
        ))}
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}
