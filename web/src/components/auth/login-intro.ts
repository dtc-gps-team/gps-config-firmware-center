"use client";

import { useReducedMotion } from "motion/react";

/**
 * ควรเล่นแอนิเมชันเปิดหน้า Login ไหม — เล่นทุกครั้งที่เปิดหน้าหรือรีเฟรช (ตามที่ขอ:
 * เป็นลายเซ็นของระบบ) ข้ามเฉพาะเมื่อผู้ใช้ตั้ง prefers-reduced-motion
 *
 * เดิมเล่นครั้งเดียวต่อ 8 ชั่วโมง (เก็บเวลาใน localStorage) — เลิกแล้ว: ไม่ต้องอ่าน
 * storage จึงไม่มีเคสที่ฝั่งเซิร์ฟเวอร์กับเบราว์เซอร์ตัดสินต่างกัน (ไม่ต้อง remount ด้วย key)
 */
export function useShouldPlayIntro(): boolean {
  return !useReducedMotion();
}
