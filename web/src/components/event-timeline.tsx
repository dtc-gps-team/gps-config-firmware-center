"use client";

import { motion } from "motion/react";

import { StatusLed, type LedTone } from "@/components/ui/status-led";
import { listItem, staggerContainer } from "@/lib/motion";

export type TimelineEvent = {
  id: string;
  /** เวลาที่เกิดเหตุการณ์ (ข้อความที่ฟอร์แมตแล้ว) */
  time: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
  tone?: LedTone;
};

/**
 * เส้นเวลาแนวตั้งของเหตุการณ์ (เก่าสุดอยู่บน) แต่ละจุดเป็น LED สถานะบนเส้นเชื่อม
 * แสดงเฉพาะเหตุการณ์ที่มีข้อมูลจริง ผู้เรียกไม่ต้องใส่ขั้นที่ยังไม่เกิด · รายการเข้าทีละแถว
 */
export function EventTimeline({
  events,
  label,
}: {
  events: TimelineEvent[];
  label: string;
}) {
  return (
    <motion.ol
      aria-label={label}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="flex flex-col"
    >
      {events.map((event, i) => (
        <motion.li
          key={event.id}
          variants={listItem}
          className="relative flex gap-3 pb-5 last:pb-0"
        >
          {i < events.length - 1 && (
            <span
              aria-hidden
              className="absolute top-4 bottom-0 left-[5px] w-px bg-border"
            />
          )}
          <span className="relative mt-1.5 flex size-3 shrink-0 items-center justify-center">
            <StatusLed tone={event.tone ?? "neutral"} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium break-words">{event.title}</p>
            <p className="font-instrument text-xs text-muted-foreground">
              {event.time}
            </p>
            {event.detail && (
              <div className="mt-1 text-sm break-words text-muted-foreground">
                {event.detail}
              </div>
            )}
          </div>
        </motion.li>
      ))}
    </motion.ol>
  );
}
