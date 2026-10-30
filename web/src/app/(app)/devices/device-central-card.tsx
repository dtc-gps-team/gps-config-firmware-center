"use client";

import {
  ActivityIcon,
  ClockIcon,
  CpuIcon,
  FileCogIcon,
  SendIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InfoRow } from "@/components/info-row";
import { useDeviceCentral } from "@/hooks/use-central-devices";
import type { CentralDevice } from "@/lib/central-device-api";
import {
  centralCommandActionLabel,
  centralCommandStatusLabel,
  centralCommandStatusTone,
} from "@/lib/central-device-display";
import { formatRelativeTime } from "@/lib/format-date";
import { StatusPill } from "@/lib/status-pill";

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warning"
      ? "border-warning/30 bg-warning-subtle text-warning-foreground"
      : "border-border bg-muted/40 text-muted-foreground";
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${cls}`}>
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span className="flex-1">{children}</span>
    </div>
  );
}

function CentralRows({ device }: { device: CentralDevice }) {
  const cmd = device.lastCommand;
  const configLabel =
    device.reportedConfigVersion === null
      ? "ยังไม่รายงาน"
      : `v${device.reportedConfigVersion}`;
  const configBehind =
    device.desiredConfigVersion !== null &&
    device.reportedConfigVersion !== device.desiredConfigVersion;

  return (
    <div className="divide-y">
      <InfoRow label="การเชื่อมต่อ" icon={ActivityIcon}>
        <StatusPill tone={device.online ? "success" : "neutral"}>
          {device.online ? "ออนไลน์" : "ออฟไลน์"}
        </StatusPill>
      </InfoRow>
      <InfoRow label="เห็นล่าสุด" icon={ClockIcon}>
        {device.lastSeenAt ? (
          formatRelativeTime(device.lastSeenAt)
        ) : (
          <span className="text-muted-foreground">ยังไม่เคยเชื่อมต่อ</span>
        )}
      </InfoRow>
      <InfoRow label="Firmware ที่กล่องรายงาน" icon={CpuIcon}>
        {device.reportedFirmwareVersion ? (
          <span className="font-instrument">{device.reportedFirmwareVersion}</span>
        ) : (
          <span className="text-muted-foreground">ยังไม่รายงาน</span>
        )}
      </InfoRow>
      <InfoRow label="Config ที่กล่องรายงาน" icon={FileCogIcon}>
        <span className="font-instrument">{configLabel}</span>
        {configBehind && (
          <span className="ml-2 text-xs text-muted-foreground">
            เป้าหมาย v{device.desiredConfigVersion}
          </span>
        )}
      </InfoRow>
      <InfoRow label="คำสั่งล่าสุด" icon={SendIcon}>
        {cmd ? (
          <div className="flex flex-col items-end gap-1">
            <span>
              {centralCommandActionLabel(cmd.action)}
              {cmd.target ? ` ถึงเวอร์ชัน ${cmd.target}` : ""}
            </span>
            <StatusPill tone={centralCommandStatusTone(cmd.status)}>
              {centralCommandStatusLabel(cmd.status)}
            </StatusPill>
            {cmd.errorCode && (
              <span className="font-instrument text-xs text-muted-foreground">
                {cmd.errorCode}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">ยังไม่เคยสั่ง</span>
        )}
      </InfoRow>
    </div>
  );
}

/**
 * การ์ด "สถานะจริงจาก Server กลาง" ในหน้ารายละเอียดอุปกรณ์ — ต่อ
 * `GET /devices/{deviceId}/central` รีเฟรชทุก 5 วินาที
 *
 * ต่างจากการ์ด "สถานะ Config และ Firmware" ตรงที่ตัวนี้มาจากสิ่งที่กล่องรายงานเอง
 * ผ่าน Server กลาง ไม่ได้คำนวณจากผล Rollout · เป็นข้อมูลเสริมเท่านั้น: ติดต่อ
 * Server กลางไม่ได้ก็แสดงแค่ในการ์ดนี้ ไม่กระทบข้อมูลหลักของหน้า
 */
export function DeviceCentralCard({ deviceId }: { deviceId: string }) {
  const state = useDeviceCentral(deviceId);
  return <DeviceCentralCardView state={state} />;
}

/** เหมือน `DeviceCentralCard` แต่รับผลจาก `useDeviceCentral` มาจากหน้าที่เรียกไว้แล้ว
 * (หน้ารายละเอียดใช้ข้อมูลชุดเดียวกันหลายจุด ไม่ poll ซ้ำ) */
export function DeviceCentralCardView({
  state,
}: {
  state: ReturnType<typeof useDeviceCentral>;
}) {
  const { data, isLoading, error, refetch } = state;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>สถานะจริงจาก Server กลาง</CardTitle>
        {data?.mode === "mock" && (
          <CardAction>
            <StatusPill tone="info">ข้อมูลตัวอย่าง</StatusPill>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && !data ? (
          <div className="flex flex-col gap-3 py-2" aria-label="กำลังโหลดสถานะจาก Server กลาง">
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : !data ? (
          <div className="flex items-center justify-between gap-3 py-2">
            <p className="text-sm text-destructive">
              {error ?? "โหลดสถานะจาก Server กลางไม่สำเร็จ"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : !data.reachable ? (
          <div className="flex items-start gap-3 py-2">
            <WifiOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">ติดต่อ Server กลางไม่ได้ตอนนี้</p>
              <p className="text-muted-foreground">
                {data.error ?? "ระบบจะลองใหม่อัตโนมัติทุก 5 วินาที"}{" "}
                ข้อมูลอื่นของเครื่องนี้ยังใช้งานได้ตามปกติ
              </p>
            </div>
          </div>
        ) : !data.device ? (
          <p className="py-2 text-sm text-muted-foreground">
            Server กลางยังไม่รู้จักเครื่องนี้
            กล่องจะปรากฏที่นี่เมื่อเชื่อมต่อ Server กลางครั้งแรก
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <CentralRows device={data.device} />
            {!data.device.registered && (
              <Notice tone="warning">
                กล่องต่อ Server กลางแล้วแต่ยังไม่อยู่ในทะเบียนของ delivery-server
                จึงยังสั่ง Config ไม่ได้ ต้องลงทะเบียนกล่องฝั่ง Server กลางก่อน
              </Notice>
            )}
            {error && (
              <Notice tone="muted">
                รีเฟรชล่าสุดไม่สำเร็จ กำลังแสดงข้อมูลครั้งก่อน
              </Notice>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
