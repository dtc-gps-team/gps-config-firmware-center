import type { Transition, Variants } from "motion/react";

/**
 * Motion system — ไฟล์กลางเดียว ทุก component ดึงค่าจากที่นี่ ห้ามเขียน
 * duration/easing เองใน component (ค่าเดียวกับ CSS variables `--duration-*` /
 * `--ease-*` ใน globals.css ซึ่งใช้กับ Tailwind/CSS transition)
 *
 * motion ใช้หน่วยวินาที ตารางนี้เก็บเป็น ms ตามสเปกแล้วแปลงตอนใช้
 * animate เฉพาะ transform/opacity · prefers-reduced-motion จัดการที่
 * `<MotionProvider>` (reducedMotion="user" → เหลือ fade ล้วน)
 */
export const duration = {
  instant: 100,
  fast: 150,
  base: 220,
  slow: 320,
  page: 400,
} as const;

const s = (ms: number) => ms / 1000;

export const ease = {
  standard: [0.2, 0, 0, 1],
  emphasizedOut: [0.05, 0.7, 0.1, 1],
} as const;

export const spring = {
  type: "spring",
  stiffness: 300,
  damping: 30,
} as const satisfies Transition;

export const transition = {
  instant: { duration: s(duration.instant), ease: ease.standard },
  fast: { duration: s(duration.fast), ease: ease.standard },
  base: { duration: s(duration.base), ease: ease.standard },
  slow: { duration: s(duration.slow), ease: ease.emphasizedOut },
  page: { duration: s(duration.page), ease: ease.emphasizedOut },
  spring,
} as const satisfies Record<string, Transition>;

/** ระยะเลื่อนตอนเข้า (px) — page transition 8-12px */
export const offset = { page: 10, item: 8, small: 4 } as const;

/** หน่วงระหว่าง child ใน stagger (วินาที) 30-50ms */
export const stagger = { tight: 0.03, base: 0.04, loose: 0.05 } as const;

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transition.base },
  exit: { opacity: 0, transition: transition.fast },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: offset.item },
  visible: { opacity: 1, y: 0, transition: transition.slow },
  exit: { opacity: 0, y: -offset.small, transition: transition.fast },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: transition.base },
  exit: { opacity: 0, scale: 0.98, transition: transition.fast },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: transition.slow },
  exit: { opacity: 0, x: 24, transition: transition.fast },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: stagger.base, delayChildren: 0.02 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: offset.small },
  visible: { opacity: 1, y: 0, transition: transition.base },
};

/** page transition: fade + เลื่อนขึ้น ~10px */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: offset.page },
  visible: { opacity: 1, y: 0, transition: transition.page },
};

/** ปฏิกิริยาของปุ่ม/การ์ด: hover ยกเล็กน้อย, กดยุบ 0.97 */
export const press = { scale: 0.97 } as const;
export const lift = { y: -1 } as const;
