"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { ErrorState } from "@/components/error-state";
import { WizardStepIndicator } from "@/components/wizard-step-indicator";
import { SegmentBar } from "@/components/segment-bar";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { describeIncompatibility } from "./rollout-compatibility";

/** Config สถานะที่ใช้ push ได้ — ตรงกับ `APPLICABLE_CONFIG_STATUSES` ฝั่ง
 * backend (mirror device.service.ts/campaign-rollout.service.ts) */
const ELIGIBLE_CONFIG_STATUSES = ["approved", "synced"];

/** Firmware สถานะที่ใช้ push ได้ — ตรงกับ `SIMULATABLE_FIRMWARE_STATUS` ฝั่ง
 * backend (firmware-status.ts) */
const ELIGIBLE_FIRMWARE_UPLOAD_STATUS = "stored";

const STEPS = [
  { n: 1, label: "เป้าหมาย" },
  { n: 2, label: "เวอร์ชัน / Config" },
  { n: 3, label: "ตรวจสอบผลกระทบ" },
  { n: 4, label: "ยืนยัน" },
] as const;

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
  const [step, setStep] = useState(1);

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

  /** เครื่องในกลุ่มที่รับ payload ที่เลือกไม่ได้ -> เหตุผล (คำนวณจากสมาชิก
   * ทุกเครื่อง ไม่ใช่แค่เครื่องที่ยังติ๊กอยู่ เพราะเครื่องพวกนี้ติ๊กเองไม่ได้
   * อยู่แล้ว) mirror เงื่อนไข 409 ของ campaign-rollout.service.ts ฝั่ง backend */
  const incompatibleReasons = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const deviceId of memberDeviceIds) {
      const device = deviceByDeviceId.get(deviceId);
      if (!device) continue;
      const reason = describeIncompatibility({
        payloadType,
        device,
        config: selectedConfig,
        firmware: selectedFirmware,
      });
      if (reason) reasons.set(deviceId, reason);
    }
    return reasons;
  }, [
    memberDeviceIds,
    deviceByDeviceId,
    payloadType,
    selectedConfig,
    selectedFirmware,
  ]);

  /** เครื่องที่จะได้รับ payload จริง = ไม่ถูกเอาออกเอง และเข้ากันได้ */
  const isDirty =
    step > 1 ||
    excludedDeviceIds.size > 0 ||
    configId !== "" ||
    firmwareId !== "";
  const { confirmLeave } = useUnsavedChangesWarning(isDirty && !submitting);

  const includedDeviceIds = memberDeviceIds.filter(
    (id) => !excludedDeviceIds.has(id) && !incompatibleReasons.has(id),
  );

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

  /** ตรวจเงื่อนไขของขั้นที่ออกจากมา คืนข้อความผิดพลาด หรือ null ถ้าไปต่อได้ */
  function validateStep(n: number): string | null {
    if (n === 1 && memberDeviceIds.length - excludedDeviceIds.size === 0) {
      return "ต้องเหลืออุปกรณ์อย่างน้อย 1 เครื่องใน Rollout นี้";
    }
    if (n === 2) {
      if (payloadType === "Config" && !configId) return "เลือก Config ก่อน";
      if (payloadType === "Firmware" && !firmwareId)
        return "เลือก Firmware ก่อน";
    }
    if (n === 3 && includedDeviceIds.length === 0) {
      return incompatibleReasons.size > 0
        ? "ไม่มีเครื่องไหนในกลุ่มที่เข้ากันกับ payload นี้ เลือก payload อื่น"
        : "ต้องเหลืออุปกรณ์อย่างน้อย 1 เครื่องใน Rollout นี้";
    }
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    setFormError(problem);
    if (!problem) setStep((n) => n + 1);
  }

  function goBack() {
    setFormError(null);
    setStep((n) => n - 1);
  }

  function handleCancel() {
    if (confirmLeave()) router.push(`/campaigns/${campaignId}`);
  }

  async function handleSubmit() {
    setFormError(null);
    if (!session?.accessToken) return;
    const problem = validateStep(2) ?? validateStep(3);
    if (problem) {
      setFormError(problem);
      return;
    }

    // เครื่องที่ไม่เข้ากันถูกปิดไม่ให้ติ๊กไว้แล้ว แต่ backend ยังต้องได้รับ
    // ใน excludeDeviceIds (ไม่งั้นตอบ 409 เพราะเครื่องพวกนี้ยังเป็นสมาชิก)
    const excludeDeviceIds = [
      ...new Set([...excludedDeviceIds, ...incompatibleReasons.keys()]),
    ];

    setSubmitting(true);
    try {
      const created = await createCampaignRollout(
        session.accessToken,
        campaignId,
        {
          payloadType,
          ...(payloadType === "Config" ? { configId } : { firmwareId }),
          ...(excludeDeviceIds.length > 0 ? { excludeDeviceIds } : {}),
        },
      );
      toast.success("เริ่ม Rollout แล้ว รอ Operation อีกคนอนุมัติ");
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
      <ErrorState
        message={loadError}
        onRetry={() => {
          void targetsQuery.refetch();
          void devicesQuery.refetch();
          void configsQuery.refetch();
          void firmwareQuery.refetch();
        }}
      />
    );
  }

  const payloadName =
    payloadType === "Config"
      ? (selectedConfig?.name ?? "-")
      : selectedFirmware
        ? `v${selectedFirmware.version}`
        : "-";
  const manuallyExcluded = memberDeviceIds.filter(
    (id) => excludedDeviceIds.has(id) && !incompatibleReasons.has(id),
  );

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <WizardStepIndicator steps={STEPS} step={step} />

      {step === 1 && (
        <Card className="gap-3 p-5">
          <div>
            <p className="text-sm font-medium">
              อุปกรณ์ในรอบนี้ (
              <span className="tabular-nums">
                {memberDeviceIds.length - excludedDeviceIds.size}/
                {memberDeviceIds.length}
              </span>
              )
            </p>
            <p className="text-xs text-muted-foreground">
              default = สมาชิกทั้งกลุ่ม
              เอาเครื่องที่ไม่พร้อมออกได้โดยเอาเครื่องหมายถูกออก
            </p>
          </div>

          {memberDeviceIds.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              กลุ่มนี้ยังไม่มีสมาชิก เพิ่มอุปกรณ์เข้ากลุ่มก่อนเริ่ม Rollout
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10"></TableHead>
                    <TableHead>เลขเครื่อง</TableHead>
                    <TableHead>โมเดล/โปรโตคอล</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberDeviceIds.map((deviceId) => {
                    const device: Device | undefined =
                      deviceByDeviceId.get(deviceId);
                    const included = !excludedDeviceIds.has(deviceId);
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
                        <TableCell className="font-instrument text-xs">
                          {deviceId}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {device
                            ? `${device.deviceModel} / ${device.protocol}`
                            : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card className="gap-4 p-5">
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
                  <SelectValue placeholder="- เลือก -">
                    {() =>
                      selectedConfig
                        ? `${selectedConfig.name} (${selectedConfig.deviceModel}/${selectedConfig.protocol})`
                        : "- เลือก -"
                    }
                  </SelectValue>
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
                  <SelectValue placeholder="- เลือก -">
                    {() =>
                      selectedFirmware
                        ? `v${selectedFirmware.version}: รองรับ ${selectedFirmware.deviceModelCompatibility.join(", ")}`
                        : "- เลือก -"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {eligibleFirmware.map((f: Firmware) => (
                    <SelectItem key={f.id} value={f.id}>
                      v{f.version}: รองรับ{" "}
                      {f.deviceModelCompatibility.join(", ")}
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
        </Card>
      )}

      {step === 3 && (
        <Card className="gap-4 p-5">
          <div>
            <p className="text-sm font-medium">ผลกระทบของ Rollout นี้</p>
            <p className="text-xs text-muted-foreground">
              เครื่องที่ไม่เข้ากันกับ{" "}
              {payloadType === "Config" ? "Config" : "Firmware"}{" "}
              ที่เลือกถูกเอาออกจากรอบนี้ให้อัตโนมัติ
            </p>
          </div>

          <SegmentBar
            segments={[
              {
                key: "send",
                label: "ได้รับ",
                value: includedDeviceIds.length,
                colorClass: "bg-success",
              },
              {
                key: "incompatible",
                label: "ไม่เข้ากัน (ข้าม)",
                value: incompatibleReasons.size,
                colorClass: "bg-warning",
              },
              {
                key: "manual",
                label: "เอาออกเอง",
                value: manuallyExcluded.length,
                colorClass: "bg-muted-foreground/40",
              },
            ]}
          />

          {incompatibleReasons.size > 0 && (
            <div className="flex flex-col gap-2">
              <p className="label-caps text-muted-foreground">
                เครื่องที่ถูกข้าม
              </p>
              <ul className="divide-y rounded-lg border">
                {[...incompatibleReasons].map(([deviceId, reason]) => (
                  <li
                    key={deviceId}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm"
                  >
                    <span className="font-instrument text-xs">{deviceId}</span>
                    <span className="text-warning-foreground">{reason}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                เครื่องเหล่านี้ต้องส่งในรอบอื่นด้วย{" "}
                {payloadType === "Config" ? "Config" : "Firmware"}{" "}
                ที่ตรงกับโมเดลของเครื่อง
              </p>
            </div>
          )}
        </Card>
      )}

      {step === 4 && (
        <Card className="gap-3 p-5">
          <p className="text-sm font-medium">ตรวจสอบก่อนเริ่ม</p>
          <dl className="divide-y text-sm">
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-muted-foreground">ประเภท Payload</dt>
              <dd>{payloadType}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-muted-foreground">
                {payloadType === "Config" ? "Config" : "Firmware"}
              </dt>
              <dd className="text-right">{payloadName}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-muted-foreground">อุปกรณ์ที่ได้รับ</dt>
              <dd className="font-instrument tabular-nums">
                {includedDeviceIds.length} จาก {memberDeviceIds.length} เครื่อง
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            เมื่อเริ่มแล้ว Rollout จะรอ Operation อีกคนอนุมัติ
            และยังไม่ถูกส่งเข้าอุปกรณ์จนกว่าจะกดปล่อย
          </p>
        </Card>
      )}

      {formError && <ErrorState message={formError} />}

      <div className="flex justify-between gap-2 border-t pt-4">
        <Button variant="outline" disabled={submitting} onClick={handleCancel}>
          ยกเลิก
        </Button>
        <div className="flex gap-2">
          {step > 1 && (
            <Button variant="outline" disabled={submitting} onClick={goBack}>
              <ArrowLeftIcon />
              ย้อนกลับ
            </Button>
          )}
          {step < STEPS.length ? (
            <Button onClick={goNext}>
              ถัดไป
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button onClick={() => void handleSubmit()} loading={submitting}>
              เริ่ม Rollout
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
