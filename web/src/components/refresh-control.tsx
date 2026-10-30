"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusLed, type LedTone } from "@/components/ui/status-led";
import {
  getDataLoadedAt,
  requestRefresh,
  subscribeDataLoaded,
} from "@/lib/refresh-bus";

/** อายุข้อมูลที่ยังถือว่า "สด" (LED เต้น) / เริ่มเตือน (LED อำพัน) — วินาที */
const FRESH_SECONDS = 15;
const STALE_SECONDS = 60;

/** "8 วินาทีที่แล้ว" / "3 นาทีที่แล้ว" — นับต่อเองทุกวินาทีโดยไม่ยิง API */
export function ageLabel(seconds: number): string {
  if (seconds < 5) return "เมื่อสักครู่";
  if (seconds < 60) return `${seconds} วินาทีที่แล้ว`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  return `${Math.floor(minutes / 60)} ชั่วโมงที่แล้ว`;
}

/**
 * ตัวบอกความสดของข้อมูลที่หัวหน้า + ปุ่มรีเฟรช — จุด LED เต้นเมื่อข้อมูลเพิ่งเข้ามา
 * (อายุ < 15 วินาที) กลายเป็นอำพันถ้านิ่งเกิน 1 นาที (เช่นเน็ตหลุด/แท็บถูกซ่อน) · เวลา
 * อ้างอิงจากครั้งล่าสุดที่ดึงสถานะกล่องจาก Server กลางสำเร็จ (poll ทุก 5 วินาที) หรือ
 * ตอนกดรีเฟรช/เปิดหน้า · กดแล้วทุก hook ในหน้าโหลดใหม่ (ผ่าน `requestRefresh`)
 */
export function RefreshControl() {
  // ฐานเวลาคือเวลาที่เปิดหน้า/กดรีเฟรช (state) กับเวลาที่ poll ล่าสุดสำเร็จ (store) เอาค่าที่ใหม่กว่า
  const [anchor, setAnchor] = useState(() => Date.now());
  const polledAt = useSyncExternalStore(
    subscribeDataLoaded,
    getDataLoadedAt,
    () => 0,
  );
  const [now, setNow] = useState(() => Date.now());
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadedAt = Math.max(anchor, polledAt);
  const seconds = Math.max(0, Math.floor((now - loadedAt) / 1000));
  const tone: LedTone =
    seconds >= STALE_SECONDS ? "warning" : seconds >= FRESH_SECONDS ? "neutral" : "online";

  function refresh() {
    requestRefresh();
    setAnchor(Date.now());
    setNow(Date.now());
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 600);
  }

  return (
    <div className="flex items-center gap-2">
      <StatusLed tone={tone} pulse={tone === "online"} />
      <p data-tabular className="text-xs text-muted-foreground">
        อัปเดต {ageLabel(seconds)}
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
