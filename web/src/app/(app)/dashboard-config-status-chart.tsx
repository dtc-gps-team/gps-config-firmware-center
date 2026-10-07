"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConfigs } from "@/hooks/use-configs";
import { CONFIG_STATUSES, type ConfigStatus } from "@/lib/config-api";
import { statusLabel } from "@/lib/status-pill";

/**
 * กราฟ stacked bar แนวนอนแสดงสัดส่วน Config ทั้งหมดแยกตามสถานะ — เลือก
 * stacked bar แทน pie/donut ตามหลักเกณฑ์ part-to-whole (pie อ่านสัดส่วนยาก
 * ขึ้นเรื่อยๆ เมื่อจำนวนหมวดเพิ่ม, stacked bar ไม่มีปัญหานี้) ใช้ชุดสี
 * categorical ที่ผ่านการ validate แล้ว (chroma floor, CVD separation,
 * normal-vision floor, contrast — ดู dataviz skill) แยกจากสี `PillTone` ที่
 * ใช้กับ badge สถานะทั่วแอป โดยตั้งใจ เพราะชุดสีเดิมไม่ผ่าน validator สำหรับ
 * การเทียบ 5 หมวดเคียงข้างกันแบบนี้ (slate อ่านเป็นเทาล้วน, sky กับ emerald
 * แยกไม่ออกสำหรับสายตาปกติ) — ลำดับสีคงที่ตาม `CONFIG_STATUSES` เสมอ ไม่สลับ
 * ตามจำนวน
 */

const SEGMENT_STYLE: Record<ConfigStatus, string> = {
  draft: "bg-[#2a78d6] dark:bg-[#3987e5]",
  testing: "bg-[#eb6834] dark:bg-[#d95926]",
  approved: "bg-[#1baf7a] dark:bg-[#199e70]",
  rejected: "bg-[#eda100] dark:bg-[#c98500]",
  synced: "bg-[#e87ba4] dark:bg-[#d55181]",
};

/** ขนาดขั้นต่ำ (% ของความกว้างทั้งแท่ง) ที่ segment จะโชว์ตัวเลขในตัวเอง —
 * แคบกว่านี้ให้พึ่ง legend/tooltip แทน (กันตัวเลขล้นออกนอก segment) */
const INLINE_LABEL_MIN_PERCENT = 12;

export function DashboardConfigStatusChart() {
  const { data, isLoading, error } = useConfigs();
  const [hovered, setHovered] = useState<ConfigStatus | null>(null);

  const counts = useMemo(() => {
    const base = Object.fromEntries(
      CONFIG_STATUSES.map((status) => [status, 0]),
    ) as Record<ConfigStatus, number>;
    if (!data) return base;
    for (const config of data) {
      base[config.status] = (base[config.status] ?? 0) + 1;
    }
    return base;
  }, [data]);

  const total = CONFIG_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const visibleSegments = CONFIG_STATUSES.filter((status) => counts[status] > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>สถานะ Config โดยรวม</CardTitle>
        <CardDescription>
          สัดส่วน Config ทั้งหมดในระบบแยกตามสถานะ ({total.toLocaleString("th-TH")} รายการ)
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 px-6 pt-4 pb-6">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : isLoading && total === 0 ? (
          <div className="h-6 w-full animate-pulse rounded bg-muted" />
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มี Config ในระบบ</p>
        ) : (
          <>
            <div className="flex h-6 w-full gap-0.5 mt-6">
              {visibleSegments.map((status, i) => {
                const percent = (counts[status] / total) * 100;
                const isFirst = i === 0;
                const isLast = i === visibleSegments.length - 1;
                return (
                  <button
                    key={status}
                    type="button"
                    className={[
                      "group relative flex items-center justify-center transition-[filter] outline-none",
                      SEGMENT_STYLE[status],
                      isFirst ? "rounded-l" : "",
                      isLast ? "rounded-r" : "",
                      hovered === status ? "brightness-110" : "",
                    ].join(" ")}
                    style={{ width: `${percent}%` }}
                    onMouseEnter={() => setHovered(status)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(status)}
                    onBlur={() => setHovered(null)}
                  >
                    {percent >= INLINE_LABEL_MIN_PERCENT && (
                      <span className="text-[#0b0b0b] text-xs font-medium tabular-nums">
                        {counts[status]}
                      </span>
                    )}
                    {hovered === status && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10">
                        <span className="font-semibold tabular-nums">
                          {counts[status]}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {statusLabel(status)}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* legend — ทำหน้าที่ table view ไปในตัว ทุกค่าที่เห็นในกราฟอ่านได้
                ตรงนี้แบบไม่ต้อง hover */}
            <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {CONFIG_STATUSES.map((status) => (
                <div key={status} className="flex items-center gap-1.5">
                  <span
                    className={`size-2.5 shrink-0 rounded-sm ${SEGMENT_STYLE[status]}`}
                  />
                  <dt className="text-muted-foreground">{statusLabel(status)}</dt>
                  <dd className="font-medium tabular-nums">{counts[status]}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </Card>
  );
}
