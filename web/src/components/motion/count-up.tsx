"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";

import { duration, ease } from "@/lib/motion";

/**
 * ตัวเลขที่นับขึ้นจากค่าเดิม (ครั้งแรกจาก 0) ไปค่าใหม่ — เขียน textContent ตรงๆ
 * ระหว่างนับ ไม่ทำให้ React render ซ้ำทุกเฟรม · ผู้ใช้ตั้ง prefers-reduced-motion
 * (หรือไม่มี matchMedia เช่นในเทส) จะข้ามไปค่าสุดท้ายทันที · `suffix` อยู่ใน
 * element เดียวกัน (เช่น "%") เพื่อให้ข้อความเป็นก้อนเดียว
 */
export function CountUp({
  value,
  suffix = "",
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = (n: number) => {
      el.textContent = `${Math.round(n).toLocaleString("th-TH")}${suffix}`;
    };
    if (reduce || shown.current === value) {
      shown.current = value;
      render(value);
      return;
    }
    const controls = animate(shown.current, value, {
      duration: duration.slow / 1000,
      ease: ease.emphasizedOut,
      onUpdate: (n) => {
        shown.current = n;
        render(n);
      },
      onComplete: () => {
        shown.current = value;
        render(value);
      },
    });
    return () => controls.stop();
  }, [value, suffix, reduce]);

  return (
    <span ref={ref} data-tabular className={className}>
      {Math.round(value).toLocaleString("th-TH")}
      {suffix}
    </span>
  );
}
