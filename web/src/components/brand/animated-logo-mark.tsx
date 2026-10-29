"use client";

import { motion, type TargetAndTransition } from "motion/react";

import { cn } from "@/lib/utils";

/** ดีเลย์ของแต่ละช่วง (วินาที) — ทั้งชุดจบราว 1.3 วินาที */
const T = { tile: 0.1, pin: 0.35, dot: 0.7, ripple: 0.78 } as const;

/** เส้นหมุดเดียวกับ `LogoMark` (lucide map-pin) */
const PIN_PATH =
  "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0";

/**
 * โลโก้เดิม (หมุดขาวในกรอบสีน้ำเงินหลัก) พร้อมแอนิเมชันเปิดหน้า Login: กรอบเด้งเข้า →
 * หมุดตกลงมาแล้วยุบ-เด้งตอนถึงพื้น → วงกลมกลางหมุดผุด → วงคลื่นแผ่ออกจากปลายหมุด
 * แล้วจางหาย (เหมือนจับพิกัดได้) · ภาพสุดท้ายตรงกับ `LogoMark` เป๊ะ (วงคลื่นจบที่
 * โปร่งใส) · `play=false` แสดงภาพสุดท้ายทันที (เล่นซ้ำ/ลดการเคลื่อนไหว) ·
 * animate เฉพาะ transform/opacity
 */
export function AnimatedLogoMark({
  play,
  className,
}: {
  play: boolean;
  className?: string;
}) {
  const from = (props: TargetAndTransition) => (play ? props : false);

  return (
    <motion.span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-white",
        className,
      )}
      initial={from({ scale: 0.55, opacity: 0 })}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        scale: { type: "spring", stiffness: 380, damping: 17, delay: T.tile },
        opacity: { duration: 0.2, delay: T.tile },
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[55%] overflow-visible"
      >
        {/* หมุดตก: จุดหมุนอยู่ที่ปลายหมุดให้ยุบ-เด้งเหมือนปักลงพื้น */}
        <motion.path
          d={PIN_PATH}
          style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
          initial={from({ y: -12, opacity: 0, scaleY: 1.2, scaleX: 0.85 })}
          animate={{ y: 0, opacity: 1, scaleY: 1, scaleX: 1 }}
          transition={{
            y: { type: "spring", stiffness: 360, damping: 13, delay: T.pin },
            scaleX: { type: "spring", stiffness: 360, damping: 11, delay: T.pin },
            scaleY: { type: "spring", stiffness: 360, damping: 11, delay: T.pin },
            opacity: { duration: 0.15, delay: T.pin },
          }}
        />
        <motion.circle
          cx="12"
          cy="10"
          r="3"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          initial={from({ scale: 0, opacity: 0 })}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 460, damping: 15, delay: T.dot }}
        />
        {/* วงคลื่นแผ่ออกจากปลายหมุด (เล่นครั้งเดียวแล้วโปร่งใส) */}
        {play && (
          <motion.ellipse
            cx="12"
            cy="21.6"
            rx="6"
            ry="1.9"
            strokeWidth={1.4}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            initial={{ scale: 0.15, opacity: 0.85 }}
            animate={{ scale: 1.25, opacity: 0 }}
            transition={{ duration: 0.8, delay: T.ripple, ease: [0.05, 0.7, 0.1, 1] }}
          />
        )}
      </svg>
    </motion.span>
  );
}
