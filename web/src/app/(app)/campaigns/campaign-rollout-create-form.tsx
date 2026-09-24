"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  createCampaignRollout,
  type CampaignPayloadType,
} from "@/lib/campaign-api";
import type { Config } from "@/lib/config-api";
import type { Device } from "@/lib/device-api";
import type { Firmware } from "@/lib/firmware-api";
import { useCampaignTargets } from "@/hooks/use-campaign-targets";
import { useConfigs } from "@/hooks/use-configs";
import { useDevices } from "@/hooks/use-devices";
import { useFirmwareList } from "@/hooks/use-firmware";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";

/** Config สถานะที่ใช้ push ได้ — ตรงกับ `APPLICABLE_CONFIG_STATUSES` ฝั่ง
 * backend (mirror device.service.ts/campaign-rollout.service.ts) */
const ELIGIBLE_CONFIG_STATUSES = ["approved", "synced"];

/** Firmware สถานะที่ใช้ push ได้ — ตรงกับ `SIMULATABLE_FIRMWARE_STATUS` ฝั่ง
 * backend (firmware-status.ts) */
const ELIGIBLE_FIRMWARE_UPLOAD_STATUS = "stored";

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm text-destructive">{message}</p>
    </div>
  );
}

function PayloadTypeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
        (active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:bg-secondary/80")
      }
    >
      {children}
    </button>
  );
}

/**
 * เริ่ม Rollout ใหม่ — เลือก Config หรือ Firmware มา push เข้ากลุ่มนี้
 * (`POST /campaigns/{id}/rollouts`, Campaign Monitor #22, แก้ไข 2026-09-24)
 *
 * default = สมาชิกทั้งกลุ่ม เอาบางเครื่องออกได้ผ่านการติ๊กออกในตาราง (ไม่มี
 * ทางเพิ่มเครื่องนอกกลุ่ม — ต่างจาก wizard เดิมที่เลือกเป้าหมายอิสระ)
 */
export function CampaignRolloutCreateForm({
  campaignId,
}: {
  campaignId: string;
}) {
  const router = useRouter();
  const { session } = useAuth();

  const targetsQuery = useCampaignTargets(campaignId);
  const devicesQuery = useDevices();
  const configsQuery = useConfigs();
  const firmwareQuery = useFirmwareList();

  const [payloadType, setPayloadType] = useState<CampaignPayloadType>("Config");
  const [configId, setConfigId] = useState("");
  const [firmwareId, setFirmwareId] = useState("");
  const [excludedDeviceIds, setExcludedDeviceIds] = useState<Set<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const eligibleConfigs = useMemo(
    () =>
      (configsQuery.data ?? []).filter((c) =>
        ELIGIBLE_CONFIG_STATUSES.includes(c.status),
      ),
    [configsQuery.data],
  );
  const eligibleFirmware = useMemo(
    () =>
      (firmwareQuery.data ?? []).filter(
        (f) => f.uploadStatus === ELIGIBLE_FIRMWARE_UPLOAD_STATUS,
      ),
    [firmwareQuery.data],
  );

  const deviceByDeviceId = useMemo(
    () => new Map((devicesQuery.data ?? []).map((d) => [d.deviceId, d])),
    [devicesQuery.data],
  );
  const memberDeviceIds = useMemo(
    () => (targetsQuery.data ?? []).map((t) => t.deviceId),
    [targetsQuery.data],
  );

  const selectedConfig = eligibleConfigs.find((c) => c.id === configId) ?? null;
  const selectedFirmware =
    eligibleFirmware.find((f) => f.id === firmwareId) ?? null;

  const includedDeviceIds = memberDeviceIds.filter(
    (id) => !excludedDeviceIds.has(id),
  );

  /** เครื่องที่ยังเลือกอยู่แต่ไม่เข้ากันกับ payload ที่เลือก — เตือนไว้ก่อน
   * ล่วงหน้า (backend เช็คซ้ำอยู่ดีตอน submit เป็น 409) mirror
   * campaign-rollout.service.ts ฝั่ง backend */
  const incompatibleDeviceIds = useMemo(() => {
    if (payloadType === "Config") {
      if (!selectedConfig) return [] as string[];
      return includedDeviceIds.filter((deviceId) => {
        const device = deviceByDeviceId.get(deviceId);
        if (!device) return false;
        return (
          device.deviceModel !== selectedConfig.deviceModel ||
          device.protocol !== selectedConfig.protocol
        );
      });
    }
    if (!selectedFirmware) return [] as string[];
    return includedDeviceIds.filter((deviceId) => {
      const device = deviceByDeviceId.get(deviceId);
      if (!device) return false;
      return !selectedFirmware.deviceModelCompatibility.includes(
        device.deviceModel,
      );
    });
  }, [
    payloadType,
    includedDeviceIds,
    selectedConfig,
    selectedFirmware,
    deviceByDeviceId,
  ]);

  function toggleExcluded(deviceId: string, included: boolean) {
    setExcludedDeviceIds((prev) => {
      const next = new Set(prev);
      if (included) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
    setFormError(null);
  }

  async function handleSubmit() {
    setFormError(null);
    if (!session?.accessToken) return;
    if (payloadType === "Config" && !configId) {
      setFormError("เลือก Config ก่อน");
      return;
    }
    if (payloadType === "Firmware" && !firmwareId) {
      setFormError("เลือก Firmware ก่อน");
      return;
    }
    if (includedDeviceIds.length === 0) {
      setFormError("ต้องเหลืออุปกรณ์อย่างน้อย 1 เครื่องใน Rollout นี้");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createCampaignRollout(
        session.accessToken,
        campaignId,
        {
          payloadType,
          ...(payloadType === "Config" ? { configId } : { firmwareId }),
          ...(excludedDeviceIds.size > 0
            ? { excludeDeviceIds: [...excludedDeviceIds] }
            : {}),
        },
      );
      toast.success("เริ่ม Rollout แล้ว — รอ Operation อีกคนอนุมัติ");
      router.push(`/campaigns/${campaignId}/rollouts/${created.id}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        setFormError(err.message);
        toast.error(err.message);
        return;
      }
      setFormError("เริ่ม Rollout ไม่สำเร็จ");
      toast.error("เริ่ม Rollout ไม่สำเร็จ");
    }
  }

  const loadingInitial =
    (targetsQuery.isLoading && !targetsQuery.data) ||
    (devicesQuery.isLoading && !devicesQuery.data) ||
    (configsQuery.isLoading && !configsQuery.data) ||
    (firmwareQuery.isLoading && !firmwareQuery.data);
  const loadError =
    targetsQuery.error ??
    devicesQuery.error ??
    configsQuery.error ??
    firmwareQuery.error;

  if (loadingInitial) {
    return <DetailSkeleton lines={6} />;
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void targetsQuery.refetch();
            void devicesQuery.refetch();
            void configsQuery.refetch();
            void firmwareQuery.refetch();
          }}
        >
          ลองใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-1.5">
          <Label>ประเภท Payload</Label>
          <div className="flex gap-2">
            <PayloadTypeButton
              active={payloadType === "Config"}
              onClick={() => {
                setPayloadType("Config");
                setFormError(null);
              }}
            >
              Config
            </PayloadTypeButton>
            <PayloadTypeButton
              active={payloadType === "Firmware"}
              onClick={() => {
                setPayloadType("Firmware");
                setFormError(null);
              }}
            >
              Firmware
            </PayloadTypeButton>
          </div>
        </div>

        {payloadType === "Config" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rollout-config">Config</Label>
            <Select
              value={configId}
              onValueChange={(value) => {
                setConfigId(value ?? "");
                setFormError(null);
              }}
            >
              <SelectTrigger id="rollout-config" className="w-full">
                <SelectValue placeholder="— เลือก —" />
              </SelectTrigger>
              <SelectContent>
                {eligibleConfigs.map((c: Config) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.deviceModel}/{c.protocol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligibleConfigs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                ยังไม่มี Config สถานะ approved/synced ให้เลือก
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rollout-firmware">Firmware</Label>
            <Select
              value={firmwareId}
              onValueChange={(value) => {
                setFirmwareId(value ?? "");
                setFormError(null);
              }}
            >
              <SelectTrigger id="rollout-firmware" className="w-full">
                <SelectValue placeholder="— เลือก —" />
              </SelectTrigger>
              <SelectContent>
                {eligibleFirmware.map((f: Firmware) => (
                  <SelectItem key={f.id} value={f.id}>
                    v{f.version} — รองรับ: {f.deviceModelCompatibility.join(", ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligibleFirmware.length === 0 && (
              <p className="text-xs text-muted-foreground">
                ยังไม่มี Firmware สถานะ stored (จัดเก็บสำเร็จแล้ว) ให้เลือก
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div>
          <p className="text-sm font-medium">
            อุปกรณ์ในรอบนี้ ({includedDeviceIds.length}/{memberDeviceIds.length})
          </p>
          <p className="text-xs text-muted-foreground">
            default = สมาชิกทั้งกลุ่ม เอาเครื่องที่ไม่พร้อมออกได้โดยเอาเครื่องหมายถูกออก
          </p>
        </div>

        {memberDeviceIds.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            กลุ่มนี้ยังไม่มีสมาชิก
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10"></TableHead>
                  <TableHead>เลขเครื่อง</TableHead>
                  <TableHead>รุ่น/โปรโตคอล</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberDeviceIds.map((deviceId) => {
                  const device: Device | undefined =
                    deviceByDeviceId.get(deviceId);
                  const included = !excludedDeviceIds.has(deviceId);
                  const incompatible =
                    included && incompatibleDeviceIds.includes(deviceId);
                  return (
                    <TableRow key={deviceId}>
                      <TableCell>
                        <Checkbox
                          checked={included}
                          onCheckedChange={(c) =>
                            toggleExcluded(deviceId, c === true)
                          }
                          aria-label={
                            included
                              ? "เอาเครื่องนี้ออกจาก Rollout"
                              : "เอาเครื่องนี้กลับเข้า Rollout"
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {deviceId}
                        {incompatible && (
                          <span className="ml-2 text-amber-600 dark:text-amber-400">
                            ไม่เข้ากันกับ payload นี้
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {device
                          ? `${device.deviceModel} / ${device.protocol}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {incompatibleDeviceIds.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            มีอุปกรณ์ {incompatibleDeviceIds.length} เครื่องที่
            {payloadType === "Config"
              ? "รุ่น/โปรโตคอลไม่ตรงกับ Config นี้"
              : "รุ่นไม่อยู่ในรายการที่ Firmware นี้รองรับ"}{" "}
            — ระบบจะปฏิเสธตอนยืนยัน เอาออกหรือเปลี่ยน
            {payloadType === "Config" ? "Config" : "Firmware"}ก่อน
          </div>
        )}
      </div>

      {formError && <ErrorBanner message={formError} />}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          variant="outline"
          disabled={submitting}
          onClick={() => router.push(`/campaigns/${campaignId}`)}
        >
          ยกเลิก
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? "กำลังเริ่ม Rollout…" : "เริ่ม Rollout"}
        </Button>
      </div>
    </div>
  );
}
