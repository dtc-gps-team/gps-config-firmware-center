"use client";

import { motion, type TargetAndTransition } from "motion/react";

import { cn } from "@/lib/utils";
import { LOGO_PIN_PATH, LOGO_STROKE_WIDTH, LOGO_VIEWBOX } from "./logo-mark";

/** ดีเลย์ของแต่ละช่วง (วินาที) — ทั้งชุดจบราว 1.2 วินาที */
const T = { pin: 0.15, dot: 0.55, ripple: 0.62 } as const;

/**
 * โลโก้หมุดตำแหน่งแบบไม่มีกรอบพร้อมแอนิเมชันเปิดหน้า Login (โทน `light` เพราะอยู่บน
 * การ์ด): หมุดตกลงมาแล้วยุบ-เด้งตอนถึงพื้น → วงกลมกลางหมุดผุด → วงคลื่นแผ่ออกจากปลาย
 * หมุดแล้วจางหาย (เหมือนจับพิกัดได้) · ภาพสุดท้ายตรงกับ `LogoMark` เป๊ะ (วงคลื่นจบที่
 * โปร่งใส) · `play=false` แสดงภาพสุดท้ายทันที (เล่นซ้ำ/ลดการเคลื่อนไหว) · animate
 * เฉพาะ transform/opacity
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
    <span
      aria-hidden="true"
      className={cn("inline-flex size-9 shrink-0 text-primary", className)}
    >
      <svg
        viewBox={LOGO_VIEWBOX}
        fill="none"
        stroke="currentColor"
        strokeWidth={LOGO_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-full overflow-visible"
      >
        {/* หมุดตก: จุดหมุนอยู่ที่ปลายหมุดให้ยุบ-เด้งเหมือนปักลงพื้น */}
        <motion.path
          d={LOGO_PIN_PATH}
          style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
          initial={from({ y: -9, opacity: 0, scaleY: 1.2, scaleX: 0.85 })}
          animate={{ y: 0, opacity: 1, scaleY: 1, scaleX: 1 }}
          transition={{
            y: { type: "spring", stiffness: 340, damping: 12, delay: T.pin },
            scaleX: { type: "spring", stiffness: 340, damping: 10, delay: T.pin },
            scaleY: { type: "spring", stiffness: 340, damping: 10, delay: T.pin },
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
            cy="21.8"
            rx="7"
            ry="2.1"
            strokeWidth={1.3}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            initial={{ scale: 0.15, opacity: 0.8 }}
            animate={{ scale: 1.25, opacity: 0 }}
            transition={{ duration: 0.85, delay: T.ripple, ease: [0.05, 0.7, 0.1, 1] }}
          />
        )}
      </svg>
    </span>
  );
}
