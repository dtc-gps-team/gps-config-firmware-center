"use client";

import { AnimatePresence, motion } from "motion/react";

import { fadeUp } from "@/lib/motion";

/** แถบการกระทำลอยกลางล่างจอ (เช่น "เลือกแล้ว 12 เครื่อง") — โผล่เมื่อ
 *  `show` เป็นจริง เลื่อนขึ้น/จางออกด้วย motion */
export function FloatingActionBar({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="floating-action-bar"
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={fadeUp}
          role="region"
          aria-label="การกระทำกับรายการที่เลือก"
          className="fixed bottom-6 left-1/2 z-(--z-overlay) flex -translate-x-1/2 items-center gap-3 rounded-lg bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-overlay"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
