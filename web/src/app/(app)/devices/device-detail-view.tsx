"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Building2Icon,
  BoxIcon,
  CalendarCheckIcon,
  CalendarIcon,
  CardSimIcon,
  CpuIcon,
  HashIcon,
  RadioIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  TerminalIcon,
  KeyRoundIcon,
  CheckIcon,
  CopyIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { canRegisterDevice } from "@/lib/permissions";
import { DEVICE_STATUS_TONE, StatusPill, statusLabel } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";
import { useDevice } from "@/hooks/use-device";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { InfoRow } from "@/components/info-row";
import { rotateDeviceKey, type Device } from "@/lib/device-api";
import { PageHeader } from "@/components/page-header";
import { DeviceCentralCard } from "./device-central-card";
import { DeviceHistorySheet } from "./device-history-sheet";
import { DeviceStatusCard } from "./device-status-card";

export function DeviceDetailView({ deviceId }: { deviceId: string }) {
  const { data, isLoading, notFound, error, refetch } = useDevice(deviceId);

  if (isLoading && !data) {
    return <DetailSkeleton />;
  }

  if (notFound || error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">
          {notFound ? `ไม่พบอุปกรณ์ ${deviceId}` : error}
        </p>
        <div className="flex gap-2">
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          )}
          <Link
            href="/devices"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            กลับไปรายการ
          </Link>
        </div>
      </div>
    );
  }

  return <DeviceDetailContent device={data} />;
}

/** ค่าที่ว่างในเครื่องที่ลงทะเบียนก่อนบังคับกรอก IMEI/Serial/Blackbox ID */
function NotRecorded() {
  return <span className="text-muted-foreground">ยังไม่ได้บันทึก</span>;
}

/**
 * ปุ่มออก API key ใหม่ — Admin/SuperAdmin เท่านั้น (gate เป็น UX เท่านั้น
 * backend บังคับสิทธิ์จริง) · key เก่าใช้ไม่ได้ทันที จึงต้องยืนยันก่อน และ
 * key ใหม่โชว์ได้ครั้งเดียวเหมือนตอนลงทะเบียน
 */
function RotateKeyControl({ deviceId }: { deviceId: string }) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!canRegisterDevice(session?.role)) return null;

  async function rotate() {
    if (!session?.accessToken) return;
    setRotating(true);
    setError(null);
    try {
      const result = await rotateDeviceKey(session.accessToken, deviceId);
      setNewKey(result.apiKey);
      setConfirming(false);
      toast.success(`ออก API key ใหม่ให้ "${deviceId}" แล้ว`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "ออก API key ใหม่ไม่สำเร็จ",
      );
    } finally {
      setRotating(false);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        <KeyRoundIcon className="size-4" />
        ออก API Key ใหม่
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ออก API Key ใหม่?</AlertDialogTitle>
            <AlertDialogDescription>
              Key เดิมของ {deviceId} จะใช้ไม่ได้ทันที และ key ใหม่ดูซ้ำไม่ได้
              หลังปิดหน้าต่าง ต้องนำ key ใหม่ไปติดตั้งที่กล่องเอง
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotating}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rotating}
              onClick={(e) => {
                e.preventDefault();
                void rotate();
              }}
            >
              {rotating ? "กำลังออก key…" : "ยืนยันออก key ใหม่"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={newKey !== null}
        onOpenChange={(open) => {
          if (!open) setNewKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>API Key ใหม่ของ {deviceId}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="flex items-start gap-2">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                เก็บ key นี้ไว้ให้ดี ดูซ้ำไม่ได้อีกหลังปิดหน้าต่างนี้
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              aria-label="API Key ใหม่"
              value={newKey ?? ""}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="คัดลอก API Key"
              onClick={() => void copyKey()}
            >
              {copied ? (
                <CheckIcon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>ปิด</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DeviceDetailContent({ device }: { device: Device }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={<span className="font-mono">{device.deviceId}</span>}
        breadcrumb={[{ label: device.deviceId }]}
        status={
          <>
            <StatusPill tone={DEVICE_STATUS_TONE[device.status] ?? "neutral"}>
              {statusLabel(device.status)}
            </StatusPill>
            {device.hardwareRevisionCode && (
              <StatusPill tone="neutral">{device.hardwareRevisionCode}</StatusPill>
            )}
          </>
        }
        actions={
          <>
            <DeviceHistorySheet deviceId={device.deviceId} />
            <RotateKeyControl deviceId={device.deviceId} />
          </>
        }
      />

      {/* สถานะไว้บนสุด — คนเปิดหน้านี้ส่วนใหญ่อยากรู้ก่อนว่าเครื่องมีปัญหาไหม
       * ข้อมูลเครื่อง (SIM/IMEI/...) ดูทีหลังได้ */}
      <DeviceStatusCard deviceId={device.deviceId} />

      <DeviceCentralCard deviceId={device.deviceId} />

      {/* เนื้อหาเป็น label/value ล้วนเหมือน Campaign detail — จำกัด max-width
       * ไว้ที่การ์ดนี้ ไม่ปล่อยเต็มความกว้างหน้าจอ (mirror ปัญหาเดียวกับที่
       * แก้ไปแล้วในหน้า detail อื่น) */}
      <Card className="max-w-xl p-4">
        <div className="divide-y">
          <InfoRow label="SIM Number" icon={CardSimIcon}>
            <span className="font-mono">{device.simNumber}</span>
          </InfoRow>
          <InfoRow label="โมเดล" icon={SlidersHorizontalIcon}>
            {device.deviceModel}
          </InfoRow>
          <InfoRow label="โปรโตคอล" icon={RadioIcon}>
            {device.protocol}
          </InfoRow>
          <InfoRow label="รหัสรุ่นย่อย (Hardware Revision)" icon={CpuIcon}>
            {device.hardwareRevisionCode ?? (
              <span className="text-muted-foreground">ไม่มีรุ่นย่อย</span>
            )}
          </InfoRow>
          <InfoRow label="IMEI" icon={SmartphoneIcon}>
            {device.imei ?? <NotRecorded />}
          </InfoRow>
          <InfoRow label="Serial Number" icon={HashIcon}>
            {device.serialNumber ?? <NotRecorded />}
          </InfoRow>
          <InfoRow label="Blackbox ID" icon={BoxIcon}>
            {device.blackboxId ?? <NotRecorded />}
          </InfoRow>
          <InfoRow label="Bootloader" icon={TerminalIcon}>
            {device.bootloader ?? (
              <span className="text-muted-foreground">ไม่ระบุ</span>
            )}
          </InfoRow>
          <InfoRow label="ลูกค้า" icon={Building2Icon}>
            {device.customer ? (
              device.customer.companyName
            ) : (
              <span className="text-muted-foreground">ไม่ระบุ</span>
            )}
          </InfoRow>
          <InfoRow label="ลงทะเบียนเมื่อ" icon={CalendarIcon}>
            {formatDateTime(device.registeredAt)}
          </InfoRow>
          <InfoRow label="ติดตั้งเมื่อ" icon={CalendarCheckIcon}>
            {device.installedAt ? formatDateTime(device.installedAt) : "-"}
          </InfoRow>
        </div>
      </Card>
    </div>
  );
}
