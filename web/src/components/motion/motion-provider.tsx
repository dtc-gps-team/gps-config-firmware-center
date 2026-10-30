"use client";

import { MotionConfig } from "motion/react";

import { transition } from "@/lib/motion";

/**
 * ครอบทั้งแอปครั้งเดียว: เปิด reducedMotion="user" ให้ motion ตัด transform/
 * layout animation เมื่อผู้ใช้ตั้ง prefers-reduced-motion เหลือแค่ fade สั้นๆ
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={transition.base}>
      {children}
    </MotionConfig>
  );
}
