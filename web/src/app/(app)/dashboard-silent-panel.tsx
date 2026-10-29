"use client";

import Link from "next/link";
import { useMemo } from "react";

import { ErrorState } from "@/components/error-state";
import { RelativeTime } from "@/components/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import type { CentralDevice } from "@/lib/central-device-api";
import { SILENT_THRESHOLD_HOURS, silentDevices } from "@/lib/dashboard-metrics";
import type { Device } from "@/lib/device-api";
import { Panel, PanelEmpty } from "./dashboard-panel";

const MAX_ROWS = 5;

/**
 * อุปกรณ์ที่ออฟไลน์และเงียบเกิน 24 ชั่วโมง — ต่างจากการ์ด "อุปกรณ์ออฟไลน์" ตรงที่
 * บอกว่าหายไปนานแค่ไหน (เครื่องที่เพิ่งหลุดไม่ใช่เรื่องเร่ง เครื่องที่หายเป็นวันคือ
 * สิ่งที่ต้องตาม) · ใช้ `lastSeenAt` จาก Server กลาง ไม่ยิง API เพิ่ม
 */
export function DashboardSilentPanel({
  devices,
  central,
  loading,
  error,
  unavailable,
  onRetry,
  className,
}: {
  devices: Device[] | null;
  central: CentralDevice[] | null;
  loading: boolean;
  error: string | null;
  /** ติดต่อ Server กลางไม่ได้ จึงไม่ทราบว่าใครเงียบ */
  unavailable: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  const silent = useMemo(
    () => (devices && central ? silentDevices(devices, central) : null),
    [devices, central],
  );

  return (
    <Panel
      title={`อุปกรณ์ที่ขาดการติดต่อเกิน ${SILENT_THRESHOLD_HOURS} ชั่วโมง`}
      href="/devices"
      description={
        silent && silent.length > 0
          ? `${silent.length.toLocaleString("th-TH")} เครื่อง เรียงที่ขาดการติดต่อนานสุดก่อน`
          : undefined
      }
      className={className}
    >
      {error ? (
        <ErrorState message="โหลดไม่สำเร็จ" onRetry={onRetry} />
      ) : unavailable ? (
        <PanelEmpty>
          ติดต่อ Server กลางไม่ได้ตอนนี้ จึงยังไม่ทราบว่าเครื่องไหนขาดการติดต่อ
        </PanelEmpty>
      ) : loading || silent === null ? (
        <Skeleton className="h-16 w-full" />
      ) : silent.length === 0 ? (
        <PanelEmpty>
          ไม่มีเครื่องที่ขาดการติดต่อเกิน {SILENT_THRESHOLD_HOURS} ชั่วโมง
        </PanelEmpty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {silent.slice(0, MAX_ROWS).map((d) => (
            <li key={d.deviceId}>
              <Link
                href={`/devices/${encodeURIComponent(d.deviceId)}`}
                className="flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-(--duration-fast) hover:bg-muted/60"
              >
                <span className="font-instrument min-w-0 flex-1 truncate">
                  {d.deviceId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {d.deviceModel}
                </span>
                {d.lastSeenAt ? (
                  <RelativeTime
                    iso={d.lastSeenAt}
                    className="w-24 text-right text-xs text-muted-foreground"
                  />
                ) : (
                  <span className="w-24 text-right text-xs text-muted-foreground">
                    ไม่เคยรายงาน
                  </span>
                )}
              </Link>
            </li>
          ))}
          {silent.length > MAX_ROWS && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              และอีก {silent.length - MAX_ROWS} เครื่อง
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}
