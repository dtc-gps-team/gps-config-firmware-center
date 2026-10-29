"use client";

import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requestRefresh } from "@/lib/refresh-bus";

function nowLabel() {
  return new Date().toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * เวลาที่โหลดข้อมูลล่าสุด + ปุ่มรีเฟรชที่หัวหน้า — เขียนว่า "โหลดล่าสุด" ไม่ใช่
 * "อัปเดตล่าสุด" เพราะค่าที่เห็นคือเวลาที่เปิดหน้าหรือกดรีเฟรชครั้งล่าสุด
 * ไม่ใช่เวลาที่เซิร์ฟเวอร์อัปเดตข้อมูล · กดแล้วทุก hook ในหน้าโหลดใหม่
 * (ผ่าน `requestRefresh`) ไอคอนหมุนสั้นๆ เป็นสัญญาณว่ารับคำสั่งแล้ว
 */
export function RefreshControl() {
  const [loadedAt, setLoadedAt] = useState(nowLabel);
  const [spinning, setSpinning] = useState(false);

  function refresh() {
    requestRefresh();
    setLoadedAt(nowLabel());
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 600);
  }

  return (
    <div className="flex items-center gap-1.5">
      <p data-tabular className="text-xs text-muted-foreground">
        โหลดล่าสุด {loadedAt} น.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={refresh}
        aria-label="รีเฟรชข้อมูล"
        title="รีเฟรชข้อมูล"
      >
        <RefreshCwIcon
          className={spinning ? "animate-spin motion-reduce:animate-none" : ""}
        />
      </Button>
    </div>
  );
}
