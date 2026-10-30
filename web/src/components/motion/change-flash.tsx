"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * วาบสีจางๆ ทับพื้นที่ของ parent เมื่อ `signal` เปลี่ยน (ไม่วาบตอน mount ครั้งแรก)
 * — บอกผู้ใช้ว่าแถวนี้เพิ่งมีข้อมูลเปลี่ยนจากการรีเฟรช · parent ต้องเป็น
 * `relative` (ใส่ `overflow-hidden` ถ้ามีมุมโค้ง) · animate เฉพาะ opacity ·
 * ไม่ทำอะไรเมื่อผู้ใช้ตั้ง prefers-reduced-motion
 */
export function ChangeFlash({ signal }: { signal: string | number | null }) {
  const reduce = useReducedMotion();
  const [state, setState] = useState({ prev: signal, count: 0 });
  // เทียบค่าระหว่าง render (รูปแบบที่ React แนะนำสำหรับ "ปรับ state เมื่อ prop เปลี่ยน")
  if (state.prev !== signal) {
    setState({ prev: signal, count: state.count + 1 });
  }

  if (reduce || state.count === 0) return null;
  return (
    <motion.span
      key={state.count}
      aria-hidden="true"
      initial={{ opacity: 0.7 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1, ease: "easeOut" }}
      className="pointer-events-none absolute inset-0 bg-primary/15"
    />
  );
}
