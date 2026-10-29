"use client";

import { useEffect } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type TargetAndTransition,
} from "motion/react";

import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  LOGO_ORBIT,
  LOGO_PIN_PATH,
  LOGO_SATELLITE_ANGLE,
  LOGO_VIEWBOX,
} from "./logo-mark";

/** ดีเลย์ของแต่ละช่วง (วินาที) — ทั้งชุดจบราว 1.4 วินาที */
const T = { pin: 0.2, led: 0.55, orbit: 0.5, satellite: 0.55 } as const;

/**
 * โลโก้ตอนเข้าหน้า Login (โทน `light` เท่านั้น เพราะอยู่บนการ์ด): หมุดตกลงมา
 * เด้งเบาๆ → LED ผุดกลางหมุด → วงโคจรวาดวนรอบ → ดาวเทียมวิ่งหนึ่งรอบแล้วจอดที่
 * ตำแหน่งเดียวกับโลโก้นิ่ง (`LogoMark`) เป๊ะ · `play=false` แสดงภาพสุดท้ายทันที
 * (เล่นซ้ำ/ลดการเคลื่อนไหว) · animate เฉพาะ transform/opacity/เส้นขอบ SVG
 */
export function AnimatedLogoMark({
  play,
  className,
}: {
  play: boolean;
  className?: string;
}) {
  // ดาวเทียมวิ่งจากมุมเริ่มต้น (ถอยหลังหนึ่งรอบ) มาจอดที่ตำแหน่งสุดท้าย
  const angle = useMotionValue(
    play ? LOGO_SATELLITE_ANGLE - Math.PI * 2 : LOGO_SATELLITE_ANGLE,
  );
  const satX = useTransform(
    angle,
    (a) => LOGO_ORBIT.cx + LOGO_ORBIT.rx * Math.cos(a),
  );
  const satY = useTransform(
    angle,
    (a) => LOGO_ORBIT.cy + LOGO_ORBIT.ry * Math.sin(a),
  );

  useEffect(() => {
    if (!play) return;
    const controls = animate(angle, LOGO_SATELLITE_ANGLE, {
      duration: 1.05,
      delay: T.satellite,
      ease: ease.emphasizedOut,
    });
    return () => controls.stop();
  }, [play, angle]);

  const hidden = (props: TargetAndTransition) => (play ? props : false);

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-20 shrink-0", className)}
    >
      <svg viewBox={LOGO_VIEWBOX} className="size-full overflow-visible" fill="none">
        <g
          transform={`rotate(${LOGO_ORBIT.tilt} ${LOGO_ORBIT.cx} ${LOGO_ORBIT.cy})`}
        >
          <motion.ellipse
            cx={LOGO_ORBIT.cx}
            cy={LOGO_ORBIT.cy}
            rx={LOGO_ORBIT.rx}
            ry={LOGO_ORBIT.ry}
            strokeWidth="1.7"
            className="stroke-primary/45"
            initial={hidden({ pathLength: 0, opacity: 0 })}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{
              duration: 0.75,
              delay: T.orbit,
              ease: ease.emphasizedOut,
            }}
          />
          <motion.circle
            cx={satX}
            cy={satY}
            r="2.2"
            className="fill-brand-accent"
            initial={hidden({ opacity: 0, scale: 0 })}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: T.satellite }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        </g>

        {/* หมุดตก + เด้ง: จุดหมุนที่ปลายหมุดให้ดูเหมือนปักลงพื้น */}
        <motion.path
          fillRule="evenodd"
          className="fill-primary"
          d={LOGO_PIN_PATH}
          style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
          initial={hidden({ y: -16, opacity: 0, scaleY: 1.18, scaleX: 0.86 })}
          animate={{ y: 0, opacity: 1, scaleY: 1, scaleX: 1 }}
          transition={{
            y: { type: "spring", stiffness: 380, damping: 14, delay: T.pin },
            scaleX: { type: "spring", stiffness: 380, damping: 12, delay: T.pin },
            scaleY: { type: "spring", stiffness: 380, damping: 12, delay: T.pin },
            opacity: { duration: 0.15, delay: T.pin },
          }}
        />

        <motion.circle
          cx={LOGO_ORBIT.cx}
          cy={LOGO_ORBIT.cy}
          r="1.5"
          className="fill-brand-accent"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          initial={hidden({ scale: 0, opacity: 0 })}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 16, delay: T.led }}
        />
      </svg>
    </span>
  );
}
