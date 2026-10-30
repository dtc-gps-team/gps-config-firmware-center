"use client";

import { useId, useRef, useState } from "react";
import { motion } from "motion/react";

import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type UrlTab = {
  id: string;
  label: string;
  /** ตัวเลขเล็กต่อท้ายชื่อแท็บ (เช่นจำนวนรายการ) */
  count?: number;
  content: React.ReactNode;
};

function readTab(param: string, ids: string[], fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = new URLSearchParams(window.location.search).get(param);
  return value && ids.includes(value) ? value : fallback;
}

/**
 * แท็บที่เก็บแท็บปัจจุบันไว้ใน URL (`?tab=config`) — เปิดลิงก์ตรงไปแท็บนั้นได้
 * เปลี่ยนแท็บใช้ replaceState (ไม่เพิ่มประวัติ Back) · คีย์ลูกศร/Home/End
 * สลับแท็บ · เนื้อหาเฉพาะแท็บที่เปิดอยู่ถูก render (แท็บอื่นไม่โหลดข้อมูล)
 */
export function UrlTabs({
  tabs,
  param = "tab",
  className,
}: {
  tabs: UrlTab[];
  param?: string;
  className?: string;
}) {
  const ids = tabs.map((t) => t.id);
  const [active, setActive] = useState(() => readTab(param, ids, ids[0]));
  const uid = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function select(id: string, focus = false) {
    setActive(id);
    const params = new URLSearchParams(window.location.search);
    if (id === ids[0]) params.delete(param);
    else params.set(param, id);
    const qs = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
    );
    if (focus) {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)
        ?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const i = ids.indexOf(active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(ids[next], true);
  }

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const selected = t.id === current.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              data-tab-id={t.id}
              aria-selected={selected}
              aria-controls={`${uid}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium outline-none transition-colors duration-(--duration-fast) ease-(--ease-standard)",
                "focus-visible:ring-2 focus-visible:ring-ring/50",
                selected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums text-secondary-foreground/80">
                  {t.count}
                </span>
              )}
              {selected && (
                <motion.span
                  layoutId={`${uid}-tab-indicator`}
                  transition={spring}
                  className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${uid}-panel-${current.id}`}
        aria-labelledby={`${uid}-tab-${current.id}`}
        tabIndex={0}
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {current.content}
      </div>
    </div>
  );
}
