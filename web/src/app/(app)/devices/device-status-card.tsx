"use client";

import {
  CpuIcon,
  FileCogIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InfoRow } from "@/components/info-row";
import { useDeviceStatus } from "@/hooks/use-device-status";
import { formatDateTime } from "@/lib/format-date";
import type { DevicePayloadStatus } from "@/lib/device-api";
import {
  DEVICE_PAYLOAD_STATUS_TONE,
  devicePayloadStatusHint,
  devicePayloadStatusLabel,
  type PayloadKind,
} from "@/lib/device-payload-status";
import { StatusPill } from "@/lib/status-pill";

function PayloadStatusValue({
  kind,
  status,
}: {
  kind: PayloadKind;
  status: DevicePayloadStatus;
}) {
  // คำอธิบายใต้ป้ายแสดงเฉพาะสถานะที่ต้องตามต่อ (รอผล/ล้มเหลว) — สถานะปกติ
  // มีแค่ป้ายก็พอ ไม่ให้การ์ดแน่นด้วยข้อความที่ไม่ต้องทำอะไร
  const needsAttention = status === "pending" || status === "failed";
  return (
    <div className="flex flex-col items-end gap-1">
      <StatusPill tone={DEVICE_PAYLOAD_STATUS_TONE[status] ?? "neutral"}>
        {devicePayloadStatusLabel(kind, status)}
      </StatusPill>
      {needsAttention && (
        <span className="text-xs text-muted-foreground">
          {devicePayloadStatusHint(kind, status)}
        </span>
      )}
    </div>
  );
}

const SOURCE_NOTE =
  "สถานะคำนวณจากผล Rollout ล่าสุดของเครื่องนี้ ไม่ได้อ่านค่าจากกล่องจริงโดยตรง";

/**
 * การ์ด "สถานะ Config และ Firmware" ในหน้ารายละเอียดอุปกรณ์ — ต่อ
 * `GET /devices/{deviceId}/status` (มือถือแสดงข้อมูลชุดเดียวกันอยู่แล้ว)
 *
 * **สถานะนี้คำนวณจากผล Rollout ล่าสุดของเครื่องนี้ ไม่ได้อ่านค่าจากกล่องจริง**
 * (ระบบยังไม่มีช่องทางให้กล่องรายงานกลับ) จึงมีไอคอน ⓘ ข้างหัวการ์ดอธิบาย
 * ที่มาไว้เสมอ กันเข้าใจผิดว่าเป็นการซิงก์จริง · โหลดไม่สำเร็จแสดงแค่ในการ์ดนี้
 * ไม่ทำให้ข้อมูลหลักของหน้าหาย
 */
export function DeviceStatusCard({ deviceId }: { deviceId: string }) {
  const { data, isLoading, error, refetch } = useDeviceStatus(deviceId);

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>สถานะ Config และ Firmware</CardTitle>
        <CardAction>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="ที่มาของสถานะ"
                  className="inline-flex text-muted-foreground hover:text-foreground"
                />
              }
            >
              <InfoIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{SOURCE_NOTE}</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading && !data ? (
          <div className="flex flex-col gap-3 py-2" aria-label="กำลังโหลดสถานะ">
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : error && !data ? (
          <div className="flex items-center justify-between gap-3 py-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : data ? (
          <>
            <div className="divide-y">
              <InfoRow label="Config" icon={FileCogIcon}>
                <PayloadStatusValue kind="config" status={data.configStatus} />
              </InfoRow>
              <InfoRow label="Firmware" icon={CpuIcon}>
                <PayloadStatusValue
                  kind="firmware"
                  status={data.firmwareStatus}
                />
              </InfoRow>
            </div>

            {data.pendingFirmwareOverride && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  มีคำขอ Firmware Override รออนุมัติ ส่งเมื่อ{" "}
                  {formatDateTime(data.pendingFirmwareOverride.overriddenAt)}
                </span>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
