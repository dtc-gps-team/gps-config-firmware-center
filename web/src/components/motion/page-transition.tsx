"use client";

import { motion } from "motion/react";

import { pageEnter } from "@/lib/motion";

/**
 * เนื้อหาหน้าเข้าด้วย fade + เลื่อนขึ้นเล็กน้อยทุก route — ใช้จาก
 * `app/(app)/template.tsx` (template รีมาวท์ทุกครั้งที่เปลี่ยน route) ทำเฉพาะ
 * ขาเข้า ไม่หน่วงการเปลี่ยนหน้า
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial="hidden" animate="visible" variants={pageEnter}>
      {children}
    </motion.div>
  );
}
