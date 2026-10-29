"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CpuIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
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
import { cn } from "@/lib/utils";
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

function PayloadTypeCard({
  active,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "bg-card hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/** รายชื่ออุปกรณ์ให้ตรวจทานซ้ำ (ขั้นตรวจสอบผลกระทบ/ยืนยัน) เลื่อนในกรอบเมื่อยาว */
function DeviceReviewList({
  title,
  ids,
  devices,
  dotClass,
}: {
  title: string;
  ids: string[];
  devices: Map<string, Device>;
  dotClass: string;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <span className={cn("size-2 rounded-full", dotClass)} />
        {title}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {ids.length} เครื่อง
        </span>
      </p>
      <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
        {ids.map((id) => {
          const device = devices.get(id);
          return (
            <li
              key={id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm"
            >
              <span className="font-instrument text-xs">{id}</span>
              <span className="text-xs text-muted-foreground">
                {device ? `${device.deviceModel} / ${device.protocol}` : "-"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** แผงสรุปด้านขวาของ wizard: เห็นผลของสิ่งที่เลือกอยู่ตลอด ไม่ต้องเดินไปขั้นสุดท้ายถึงรู้ว่าส่งกี่เครื่อง */
function RolloutSummary({
  payloadType,
  payloadName,
  total,
  included,
  incompatible,
  manual,
}: {
  payloadType: CampaignPayloadType;
  payloadName: string | null;
  total: number;
  included: number;
  incompatible: number;
  manual: number;
}) {
  return (
    <Card
      className="gap-4 p-5 lg:sticky lg:top-20"
      data-testid="rollout-summary"
    >
      <p className="label-caps text-muted-foreground">สรุป Rollout</p>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">ประเภท</dt>
          <dd className="font-medium">{payloadType}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">
            {payloadType === "Config" ? "Config ที่จะส่ง" : "Firmware ที่จะส่ง"}
          </dt>
          <dd
            className={
              payloadName ? "font-medium break-words" : "text-muted-foreground"
            }
          >
            {payloadName ?? "ยังไม่ได้เลือก"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-xs text-muted-foreground">อุปกรณ์ที่จะได้รับ</p>
        <p className="font-instrument tabular-nums">
          <span className="text-3xl font-semibold">{included}</span>
          <span className="text-sm text-muted-foreground">
            {" "}
            / {total} เครื่อง
          </span>
        </p>
        <SegmentBar
          legend={false}
          segments={[
            {
              key: "send",
              label: "ได้รับ",
              value: included,
              colorClass: "bg-success",
            },
            {
              key: "incompatible",
              label: "ข้าม",
              value: incompatible,
              colorClass: "bg-destructive",
            },
            {
              key: "manual",
              label: "เอาออก",
              value: manual,
              colorClass: "bg-muted-foreground/40",
            },
          ]}
        />
        {(incompatible > 0 || manual > 0) && (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {incompatible > 0 && (
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-destructive" />
                ไม่เข้ากัน {incompatible} เครื่อง ต้องแก้ก่อนไปต่อ
              </li>
            )}
            {manual > 0 && (
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-muted-foreground/40" />
                คุณเอาออกเอง {manual} เครื่อง
              </li>
            )}
          </ul>
        )}
      </div>

      <p className="border-t pt-4 text-xs text-muted-foreground">
        เริ่มแล้วรอ Operation อีกคนอนุมัติ
        และยังไม่ส่งเข้าอุปกรณ์จนกว่าจะกดปล่อย
      </p>
    </Card>
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

  /** เครื่องที่ไม่เข้ากับ payload และยังไม่ถูกเอาออก = ขวางไม่ให้ไปต่อ (ไม่ข้ามให้เงียบๆ
   * เพราะผู้ใช้ต้องรู้และตัดสินใจเองว่าจะเอาออกหรือเปลี่ยน payload) */
  const blocking = [...incompatibleReasons].filter(
    ([id]) => !excludedDeviceIds.has(id),
  );
  const payloadKind = payloadType === "Config" ? "Config" : "Firmware";

  function removeBlocking() {
    setExcludedDeviceIds((prev) => {
      const next = new Set(prev);
      for (const [id] of blocking) next.add(id);
      return next;
    });
    setFormError(null);
  }

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
    if (n === 3 && blocking.length > 0) {
      return includedDeviceIds.length === 0
        ? `ไม่มีเครื่องไหนในกลุ่มที่เข้ากันกับ ${payloadKind} นี้ ย้อนกลับไปเลือกตัวอื่น`
        : `มี ${blocking.length} เครื่องที่ไม่เข้ากับ ${payloadKind} นี้ เอาออกจากรอบนี้หรือย้อนกลับไปเลือกตัวอื่นก่อนไปต่อ`;
    }
    if (n === 3 && includedDeviceIds.length === 0) {
      return "ต้องเหลืออุปกรณ์อย่างน้อย 1 เครื่องใน Rollout นี้";
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
    const excludeDeviceIds = [...excludedDeviceIds];

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
  const manuallyExcluded = memberDeviceIds.filter((id) =>
    excludedDeviceIds.has(id),
  );

  return (
    <div className="flex flex-col gap-6">
      <WizardStepIndicator steps={STEPS} step={step} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
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
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      เลือกแล้ว{" "}
                      {memberDeviceIds.length - excludedDeviceIds.size} จาก{" "}
                      {memberDeviceIds.length}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExcludedDeviceIds(new Set())}
                        disabled={excludedDeviceIds.size === 0}
                      >
                        เลือกทั้งหมด
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExcludedDeviceIds(new Set(memberDeviceIds))
                        }
                        disabled={
                          excludedDeviceIds.size === memberDeviceIds.length
                        }
                      >
                        ล้างทั้งหมด
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[28rem] overflow-y-auto rounded-lg border">
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
                </>
              )}
            </Card>
          )}

          {step === 2 && (
            <Card className="gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <Label id="payload-type-label">ประเภท Payload</Label>
                <div
                  role="radiogroup"
                  aria-labelledby="payload-type-label"
                  className="flex flex-col gap-2 sm:flex-row"
                >
                  <PayloadTypeCard
                    active={payloadType === "Config"}
                    icon={SlidersHorizontalIcon}
                    title="Config"
                    description="ส่งค่าตั้งค่าที่อนุมัติแล้วเข้าอุปกรณ์"
                    onClick={() => {
                      setPayloadType("Config");
                      setFormError(null);
                    }}
                  />
                  <PayloadTypeCard
                    active={payloadType === "Firmware"}
                    icon={CpuIcon}
                    title="Firmware"
                    description="อัปเดตเฟิร์มแวร์ที่จัดเก็บแล้วเข้าอุปกรณ์"
                    onClick={() => {
                      setPayloadType("Firmware");
                      setFormError(null);
                    }}
                  />
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
                      ยังไม่มี Firmware สถานะ stored (จัดเก็บสำเร็จแล้ว)
                      ให้เลือก
                    </p>
                  )}
                </div>
              )}
              {(payloadType === "Config" ? selectedConfig : selectedFirmware) &&
                blocking.length > 0 && (
                  <Notice tone="warning">
                    {blocking.length} เครื่องในกลุ่มไม่เข้ากับตัวที่เลือก
                    ต้องเอาออกจากรอบนี้หรือเลือกตัวอื่นก่อนไปต่อ
                  </Notice>
                )}
            </Card>
          )}

          {step === 3 && (
            <Card className="gap-4 p-5">
              <div>
                <p className="text-sm font-medium">ผลกระทบของ Rollout นี้</p>
                <p className="text-xs text-muted-foreground">
                  ทุกเครื่องในรอบนี้ต้องเข้ากับ {payloadKind} ที่เลือก
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
                    label: "ไม่เข้ากัน",
                    value: blocking.length,
                    colorClass: "bg-destructive",
                  },
                  {
                    key: "manual",
                    label: "เอาออกเอง",
                    value: manuallyExcluded.length,
                    colorClass: "bg-muted-foreground/40",
                  },
                ]}
              />

              <DeviceReviewList
                title="อุปกรณ์ที่จะได้รับ"
                ids={includedDeviceIds}
                devices={deviceByDeviceId}
                dotClass="bg-success"
              />
              <DeviceReviewList
                title="อุปกรณ์ที่เอาออกเอง"
                ids={manuallyExcluded}
                devices={deviceByDeviceId}
                dotClass="bg-muted-foreground/40"
              />
              {blocking.length > 0 && (
                <div className="flex flex-col gap-3">
                  <Notice tone="danger">
                    ไปต่อไม่ได้: มี {blocking.length} เครื่องที่ไม่เข้ากับ{" "}
                    {payloadKind} นี้ ถ้าส่งไป เครื่องจะไม่รับค่า
                  </Notice>
                  <p className="label-caps text-muted-foreground">
                    เครื่องที่ไม่เข้ากัน
                  </p>
                  <ul className="divide-y rounded-lg border">
                    {blocking.map(([deviceId, reason]) => (
                      <li
                        key={deviceId}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm"
                      >
                        <span className="font-instrument text-xs">
                          {deviceId}
                        </span>
                        <span className="text-danger-foreground">{reason}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      เครื่องเหล่านี้ต้องส่งในรอบอื่นด้วย {payloadKind}{" "}
                      ที่ตรงกับโมเดลของเครื่อง
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={removeBlocking}
                    >
                      เอาเครื่องเหล่านี้ออกจากรอบนี้
                    </Button>
                  </div>
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
                    {includedDeviceIds.length} จาก {memberDeviceIds.length}{" "}
                    เครื่อง
                  </dd>
                </div>
              </dl>
              <DeviceReviewList
                title="อุปกรณ์ที่จะได้รับ"
                ids={includedDeviceIds}
                devices={deviceByDeviceId}
                dotClass="bg-success"
              />
              <DeviceReviewList
                title="อุปกรณ์ที่เอาออก"
                ids={manuallyExcluded}
                devices={deviceByDeviceId}
                dotClass="bg-muted-foreground/40"
              />
              <p className="text-xs text-muted-foreground">
                เมื่อเริ่มแล้ว Rollout จะรอ Operation อีกคนอนุมัติ
                และยังไม่ถูกส่งเข้าอุปกรณ์จนกว่าจะกดปล่อย
              </p>
            </Card>
          )}

          {formError && <ErrorState message={formError} />}

          <div className="flex justify-between gap-2 border-t pt-4">
            <Button
              variant="outline"
              disabled={submitting}
              onClick={handleCancel}
            >
              ยกเลิก
            </Button>
            <div className="flex gap-2">
              {step > 1 && (
                <Button
                  variant="outline"
                  disabled={submitting}
                  onClick={goBack}
                >
                  <ArrowLeftIcon />
                  ย้อนกลับ
                </Button>
              )}
              {step < STEPS.length ? (
                <Button
                  onClick={goNext}
                  disabled={step === 3 && blocking.length > 0}
                >
                  ถัดไป
                  <ArrowRightIcon />
                </Button>
              ) : (
                <Button
                  onClick={() => void handleSubmit()}
                  loading={submitting}
                >
                  เริ่ม Rollout
                </Button>
              )}
            </div>
          </div>
        </div>

        <RolloutSummary
          payloadType={payloadType}
          payloadName={payloadName === "-" ? null : payloadName}
          total={memberDeviceIds.length}
          included={includedDeviceIds.length}
          incompatible={blocking.length}
          manual={manuallyExcluded.length}
        />
      </div>
    </div>
  );
}
