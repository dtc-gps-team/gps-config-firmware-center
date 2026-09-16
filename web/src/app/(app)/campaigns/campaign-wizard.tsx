"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  createCampaign,
  type CampaignPayloadType,
  type CampaignTargetInput,
} from "@/lib/campaign-api";
import type { Config } from "@/lib/config-api";
import type { Device } from "@/lib/device-api";
import type { Firmware } from "@/lib/firmware-api";
import { useConfigs } from "@/hooks/use-configs";
import { useDevices } from "@/hooks/use-devices";
import { useFirmwareList } from "@/hooks/use-firmware";

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

/** Config สถานะที่ใช้สร้างแคมเปญได้ — ตรงกับ `APPLICABLE_CONFIG_STATUSES`
 * ฝั่ง backend (mirror device.service.ts/campaign.service.ts) */
const CAMPAIGN_ELIGIBLE_CONFIG_STATUSES = ["approved", "synced"];

/** Firmware สถานะที่ใช้สร้างแคมเปญได้ — ตรงกับ `SIMULATABLE_FIRMWARE_STATUS`
 * ฝั่ง backend (firmware-status.ts) — ต้องอัปโหลดเก็บลง Object Storage
 * สำเร็จแล้วเท่านั้น (แก้ไข 2026-09-14 — เปิดใช้งาน payloadType Firmware) */
const CAMPAIGN_ELIGIBLE_FIRMWARE_UPLOAD_STATUS = "stored";

/** ค่าที่ใช้แทน "ไม่ได้ผูกลูกค้า" ในตัวกรอง — mirror ข้อความเดียวกับคอลัมน์
 * "ลูกค้า" ในหน้า Device Search (docs/12 เฟส B) */
const UNASSIGNED_CUSTOMER = "ไม่ระบุ";

const STEPS = [
  { n: 1, label: "เลือกเป้าหมาย" },
  { n: 2, label: "เลือก Payload" },
  { n: 3, label: "Rollout" },
  { n: 4, label: "ตรวจสอบ & ยืนยัน" },
] as const;

type Step = (typeof STEPS)[number]["n"];

/**
 * Campaign Wizard (Sprint 3 #21) — สร้างแคมเปญใหม่ 4 ขั้น ตาม wireframe ที่
 * พี่เลี้ยง approve ไว้แต่แรก (เลือกเป้าหมาย / เลือก Payload / Rollout /
 * ตรวจสอบ&ยืนยัน — เดิมขั้นสุดท้ายชื่อ "ส่งอนุมัติ" แต่เปลี่ยนเป็น "ยืนยัน"
 * เพราะ `CampaignStatus` ไม่มี approval workflow แยกแบบ Config)
 *
 * v1 = "ส่งพร้อมกันหมด" ล้วน (ไม่มี rollout strategy ให้เลือก) และรองรับแค่
 * `payloadType: Config` (Firmware ยังไม่มี backend module ให้เลือก เลือกไม่ได้
 * ในฟอร์มนี้เลย — ตรงกับที่ backend คืน 400 ถ้าฝืนส่งมา)
 *
 * **แก้ไข 2026-09-14 (1):** เดิมขั้นที่ 1 มีการมอบหมายผู้รับผิดชอบหน้างานต่อ
 * อุปกรณ์ด้วย (dropdown เลือกช่าง ST/OT + validate ครบก่อนไปขั้นถัดไป) —
 * หัวหน้าแก้ scope ว่า Campaign มีไว้ติดตาม/บำรุงรักษาอุปกรณ์เป็นกลุ่มเท่านั้น
 * ไม่ใช่เครื่องมือมอบหมายงาน (เป็นหน้าที่ของระบบแยกที่บริษัทมีอยู่แล้ว) —
 * ตัดขั้นตอนมอบหมายทั้งหมดออก เหลือแค่เลือกอุปกรณ์เป้าหมาย (ดู backend PR #152)
 *
 * **แก้ไข 2026-09-14 (2):** เปิดเลือก `payloadType: Firmware` ได้แล้ว
 * (backend PR #154) — ขั้นที่ 2 มีปุ่มสลับ Config/Firmware จริง แทนที่ป้าย
 * "Firmware (ยังไม่รองรับ)" เดิม เกณฑ์ความเข้ากันได้ของอุปกรณ์เป้าหมายก็ต่าง
 * กันตาม payloadType (Config เทียบ deviceModel+protocol, Firmware เทียบแค่
 * deviceModel อยู่ใน deviceModelCompatibility — mirror backend)
 */
export function CampaignWizard() {
  const router = useRouter();
  const { session } = useAuth();

  const devicesQuery = useDevices();
  const configsQuery = useConfigs();
  const firmwareQuery = useFirmwareList();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  // "" = ทุกลูกค้า (ไม่กรอง) — ค่าอื่นเป็นชื่อบริษัทตรงๆ หรือ UNASSIGNED_CUSTOMER
  // สำหรับเครื่องที่ยังไม่ผูกลูกค้า (docs/12 เฟส B)
  const [customerFilter, setCustomerFilter] = useState("");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [payloadType, setPayloadType] = useState<CampaignPayloadType>("Config");
  const [configId, setConfigId] = useState("");
  const [firmwareId, setFirmwareId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function clearErrors() {
    setNameError(null);
    setFormError(null);
  }

  const installedDevices = useMemo(
    () => (devicesQuery.data ?? []).filter((d) => d.status === "installed"),
    [devicesQuery.data],
  );

  /** ชื่อลูกค้าที่มีอยู่จริงในอุปกรณ์ที่ installed ทั้งหมด (เรียงตามตัวอักษร) +
   * "ไม่ระบุ" ต่อท้ายถ้ามีอย่างน้อย 1 เครื่องที่ยังไม่ผูกลูกค้า — derive จาก
   * ข้อมูลที่โหลดมาแล้วเหมือน filter อื่นๆ ในหน้านี้ (ไม่ยิง `GET /customers`
   * แยก ต่างจาก "ช่วงที่ 2" ที่ยังไม่ทำ ซึ่งต้องเห็นลูกค้าที่ยังไม่มีอุปกรณ์ด้วย) */
  const customerOptions = useMemo(() => {
    const names = new Set<string>();
    let hasUnassigned = false;
    for (const d of installedDevices) {
      if (d.customer) names.add(d.customer.companyName);
      else hasUnassigned = true;
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    return hasUnassigned ? [...sorted, UNASSIGNED_CUSTOMER] : sorted;
  }, [installedDevices]);

  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return installedDevices.filter((d) => {
      const matchesSearch =
        !q ||
        d.deviceId.toLowerCase().includes(q) ||
        d.deviceModel.toLowerCase().includes(q);
      const companyName = d.customer?.companyName ?? UNASSIGNED_CUSTOMER;
      const matchesCustomer = !customerFilter || companyName === customerFilter;
      return matchesSearch && matchesCustomer;
    });
  }, [installedDevices, search, customerFilter]);

  const eligibleConfigs = useMemo(
    () =>
      (configsQuery.data ?? []).filter((c) =>
        CAMPAIGN_ELIGIBLE_CONFIG_STATUSES.includes(c.status),
      ),
    [configsQuery.data],
  );

  const eligibleFirmware = useMemo(
    () =>
      (firmwareQuery.data ?? []).filter(
        (f) => f.uploadStatus === CAMPAIGN_ELIGIBLE_FIRMWARE_UPLOAD_STATUS,
      ),
    [firmwareQuery.data],
  );

  const selectedConfig = eligibleConfigs.find((c) => c.id === configId) ?? null;
  const selectedFirmware =
    eligibleFirmware.find((f) => f.id === firmwareId) ?? null;
  const deviceByDeviceId = useMemo(
    () => new Map(installedDevices.map((d) => [d.deviceId, d])),
    [installedDevices],
  );

  /** เครื่องที่เลือกไว้แต่ไม่เข้ากันกับ payload ที่เลือก — เตือนไว้ก่อนล่วงหน้า
   * (backend เช็คซ้ำอยู่ดีตอน submit เป็น 409) เกณฑ์ต่างกันตาม payloadType:
   * Config เทียบ deviceModel+protocol ตรงเป๊ะ, Firmware เทียบแค่ deviceModel
   * อยู่ใน deviceModelCompatibility (mirror campaign.service.ts ฝั่ง backend) */
  const incompatibleTargets = useMemo(() => {
    if (payloadType === "Config") {
      if (!selectedConfig) return [] as string[];
      return selectedDeviceIds.filter((deviceId) => {
        const device = deviceByDeviceId.get(deviceId);
        if (!device) return false;
        return (
          device.deviceModel !== selectedConfig.deviceModel ||
          device.protocol !== selectedConfig.protocol
        );
      });
    }
    if (!selectedFirmware) return [] as string[];
    return selectedDeviceIds.filter((deviceId) => {
      const device = deviceByDeviceId.get(deviceId);
      if (!device) return false;
      return !selectedFirmware.deviceModelCompatibility.includes(
        device.deviceModel,
      );
    });
  }, [
    payloadType,
    selectedDeviceIds,
    selectedConfig,
    selectedFirmware,
    deviceByDeviceId,
  ]);

  function toggleDevice(deviceId: string, checked: boolean) {
    setSelectedDeviceIds((prev) => {
      if (checked) {
        return prev.includes(deviceId) ? prev : [...prev, deviceId];
      }
      return prev.filter((id) => id !== deviceId);
    });
    clearErrors();
  }

  function goToStep(next: Step) {
    clearErrors();
    if (next === 2) {
      const trimmed = name.trim();
      if (!trimmed) {
        setNameError("ต้องตั้งชื่อแคมเปญ");
        return;
      }
      if (selectedDeviceIds.length === 0) {
        setFormError("เลือกอุปกรณ์เป้าหมายอย่างน้อย 1 เครื่อง");
        return;
      }
    }
    if (next === 3) {
      if (payloadType === "Config" && !configId) {
        setFormError("เลือก Config ก่อน");
        return;
      }
      if (payloadType === "Firmware" && !firmwareId) {
        setFormError("เลือก Firmware ก่อน");
        return;
      }
    }
    setStep(next);
  }

  async function handleSubmit() {
    clearErrors();
    if (!session?.accessToken) return;
    if (payloadType === "Config" && !configId) return;
    if (payloadType === "Firmware" && !firmwareId) return;

    const targetInputs: CampaignTargetInput[] = selectedDeviceIds.map(
      (deviceId) => ({ deviceId }),
    );

    setSubmitting(true);
    try {
      const trimmedDesc = description.trim();
      const created = await createCampaign(session.accessToken, {
        name: name.trim(),
        payloadType,
        ...(payloadType === "Config" ? { configId } : { firmwareId }),
        targets: targetInputs,
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
      });
      toast.success(`สร้างแคมเปญ "${created.name}" แล้ว`);
      router.push(`/campaigns/${created.id}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        setFormError(err.message);
        toast.error(err.message);
        return;
      }
      setFormError("สร้างแคมเปญไม่สำเร็จ");
      toast.error("สร้างแคมเปญไม่สำเร็จ");
    }
  }

  const loadingInitial =
    (devicesQuery.isLoading && !devicesQuery.data) ||
    (configsQuery.isLoading && !configsQuery.data) ||
    (firmwareQuery.isLoading && !firmwareQuery.data);

  const loadError = devicesQuery.error ?? configsQuery.error ?? firmwareQuery.error;

  if (loadingInitial) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลดข้อมูล…
      </p>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
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
    <div className="flex flex-col gap-6">
      <StepIndicator step={step} />

      {step === 1 && (
        <TargetsStep
          name={name}
          onNameChange={(v) => {
            setName(v);
            clearErrors();
          }}
          description={description}
          onDescriptionChange={(v) => {
            setDescription(v);
            clearErrors();
          }}
          nameError={nameError}
          search={search}
          onSearchChange={setSearch}
          customerOptions={customerOptions}
          customerFilter={customerFilter}
          onCustomerFilterChange={setCustomerFilter}
          devices={filteredDevices}
          selectedDeviceIds={selectedDeviceIds}
          onToggleDevice={toggleDevice}
          formError={formError}
          onCancel={() => router.push("/campaigns")}
          onNext={() => goToStep(2)}
        />
      )}

      {step === 2 && (
        <PayloadStep
          payloadType={payloadType}
          onSelectPayloadType={(v) => {
            setPayloadType(v);
            clearErrors();
          }}
          configs={eligibleConfigs}
          configId={configId}
          onSelectConfig={(v) => {
            setConfigId(v);
            clearErrors();
          }}
          firmwareList={eligibleFirmware}
          firmwareId={firmwareId}
          onSelectFirmware={(v) => {
            setFirmwareId(v);
            clearErrors();
          }}
          incompatibleCount={incompatibleTargets.length}
          formError={formError}
          onBack={() => goToStep(1)}
          onNext={() => goToStep(3)}
        />
      )}

      {step === 3 && (
        <RolloutStep onBack={() => goToStep(2)} onNext={() => goToStep(4)} />
      )}

      {step === 4 && (
        <ReviewStep
          name={name}
          description={description}
          payloadType={payloadType}
          config={selectedConfig}
          firmware={selectedFirmware}
          targets={selectedDeviceIds.map((deviceId) => ({
            deviceId,
            device: deviceByDeviceId.get(deviceId) ?? null,
          }))}
          incompatibleCount={incompatibleTargets.length}
          submitting={submitting}
          formError={formError}
          onBack={() => goToStep(3)}
          onSubmit={() => void handleSubmit()}
        />
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STEPS.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-8 bg-border" />}
            <span
              className={
                "flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs font-medium " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground")
              }
            >
              <span
                className={
                  "flex size-5 items-center justify-center rounded-full text-[0.65rem] " +
                  (active
                    ? "bg-primary-foreground text-primary"
                    : "bg-border text-muted-foreground")
                }
              >
                {done ? <CheckIcon className="size-3" /> : s.n}
              </span>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm text-destructive">{message}</p>
    </div>
  );
}

function TargetsStep({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  nameError,
  search,
  onSearchChange,
  customerOptions,
  customerFilter,
  onCustomerFilterChange,
  devices,
  selectedDeviceIds,
  onToggleDevice,
  formError,
  onCancel,
  onNext,
}: {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  nameError: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  customerOptions: string[];
  customerFilter: string;
  onCustomerFilterChange: (v: string) => void;
  devices: Device[];
  selectedDeviceIds: string[];
  onToggleDevice: (deviceId: string, checked: boolean) => void;
  formError: string | null;
  onCancel: () => void;
  onNext: () => void;
}) {
  const selectedCount = selectedDeviceIds.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-w-xl flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-name">ชื่อแคมเปญ</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={120}
            placeholder="เช่น อัปเดต APN ภาคกลาง Q3"
            aria-invalid={nameError ? true : undefined}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-description">
            คำอธิบาย{" "}
            <span className="font-normal text-muted-foreground">
              (ไม่บังคับ)
            </span>
          </Label>
          <textarea
            id="campaign-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="อธิบายวัตถุประสงค์ของแคมเปญนี้…"
            className="min-h-16 resize-y rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">เลือกอุปกรณ์เป้าหมาย</p>
            <p className="text-xs text-muted-foreground">
              ติ๊กช่องซ้ายมือหรือคลิกที่แถวเพื่อเลือก/ยกเลิก · เฉพาะอุปกรณ์
              สถานะ installed เท่านั้น · เลือกแล้ว {selectedCount} เครื่อง
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={customerFilter}
              onChange={(e) => onCustomerFilterChange(e.target.value)}
              className={`${SELECT_CLASS} h-8 max-w-40`}
            >
              <option value="">ลูกค้า: ทั้งหมด</option>
              {customerOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="ค้นหาเลขเครื่อง/รุ่น…"
              className="h-8 max-w-52"
            />
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-lg border">
          {devices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              ไม่พบอุปกรณ์ที่ installed
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-2 py-2 text-left">เลขเครื่อง</th>
                  <th className="px-2 py-2 text-left">รุ่น/โปรโตคอล</th>
                  <th className="px-2 py-2 text-left">ลูกค้า</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const checked = selectedDeviceIds.includes(device.deviceId);
                  return (
                    <tr
                      key={device.deviceId}
                      onClick={() =>
                        onToggleDevice(device.deviceId, !checked)
                      }
                      className="cursor-pointer border-t hover:bg-muted/50"
                    >
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) =>
                            onToggleDevice(device.deviceId, c === true)
                          }
                          // border-input เดิม (#E2E6EB) จางเกินไปจนแทบมองไม่
                          // เห็นเป็นกล่อง checkbox เมื่ออยู่เดี่ยวๆ ในตาราง
                          // (ไม่มี label ข้างๆ ช่วยเดา ต่างจากที่อื่นที่ใช้
                          // Checkbox คู่กับ label เสมอ) — override เป็น
                          // border-muted-foreground ให้เห็นเป็นกล่องชัดเจน
                          className="size-5 border-2 border-muted-foreground"
                        />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {device.deviceId}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {device.deviceModel} / {device.protocol}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {device.customer ? (
                          device.customer.companyName
                        ) : (
                          <span className="italic">{UNASSIGNED_CUSTOMER}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {formError && <ErrorBanner message={formError} />}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button onClick={onNext}>ถัดไป: เลือก Payload →</Button>
      </div>
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

function PayloadStep({
  payloadType,
  onSelectPayloadType,
  configs,
  configId,
  onSelectConfig,
  firmwareList,
  firmwareId,
  onSelectFirmware,
  incompatibleCount,
  formError,
  onBack,
  onNext,
}: {
  payloadType: CampaignPayloadType;
  onSelectPayloadType: (type: CampaignPayloadType) => void;
  configs: Config[];
  configId: string;
  onSelectConfig: (id: string) => void;
  firmwareList: Firmware[];
  firmwareId: string;
  onSelectFirmware: (id: string) => void;
  incompatibleCount: number;
  formError: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-1.5">
          <Label>ประเภท Payload</Label>
          <div className="flex gap-2">
            <PayloadTypeButton
              active={payloadType === "Config"}
              onClick={() => onSelectPayloadType("Config")}
            >
              Config
            </PayloadTypeButton>
            <PayloadTypeButton
              active={payloadType === "Firmware"}
              onClick={() => onSelectPayloadType("Firmware")}
            >
              Firmware
            </PayloadTypeButton>
          </div>
        </div>

        {payloadType === "Config" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-config">Config</Label>
            <select
              id="campaign-config"
              value={configId}
              onChange={(e) => onSelectConfig(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">— เลือก —</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.deviceModel}/{c.protocol})
                </option>
              ))}
            </select>
            {configs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                ยังไม่มี Config สถานะ approved/synced ให้เลือก
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-firmware">Firmware</Label>
            <select
              id="campaign-firmware"
              value={firmwareId}
              onChange={(e) => onSelectFirmware(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">— เลือก —</option>
              {firmwareList.map((f) => (
                <option key={f.id} value={f.id}>
                  v{f.version} — รองรับ: {f.deviceModelCompatibility.join(", ")}
                </option>
              ))}
            </select>
            {firmwareList.length === 0 && (
              <p className="text-xs text-muted-foreground">
                ยังไม่มี Firmware สถานะ stored (จัดเก็บสำเร็จแล้ว) ให้เลือก
              </p>
            )}
          </div>
        )}

        {incompatibleCount > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            มีอุปกรณ์เป้าหมาย {incompatibleCount} เครื่องที่
            {payloadType === "Config"
              ? "รุ่น/โปรโตคอลไม่ตรงกับ Config นี้"
              : "รุ่นไม่อยู่ในรายการที่ Firmware นี้รองรับ"}{" "}
            — ระบบจะปฏิเสธตอนยืนยัน ย้อนกลับไปแก้เป้าหมายหรือเปลี่ยน
            {payloadType === "Config" ? "Config" : "Firmware"}ก่อน
          </div>
        )}
      </div>

      {formError && <ErrorBanner message={formError} />}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onBack}>
          ← ย้อนกลับ
        </Button>
        <Button onClick={onNext}>ถัดไป: Rollout →</Button>
      </div>
    </div>
  );
}

function RolloutStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-5">
        <p className="text-sm font-medium">กลยุทธ์ Rollout</p>
        <p className="text-sm text-muted-foreground">
          เวอร์ชันนี้รองรับ <strong className="text-foreground">
            &ldquo;ส่งพร้อมกันหมด&rdquo;
          </strong>{" "}
          เท่านั้น — ทุกเครื่องในรายการเป้าหมายจะถูกบันทึกเข้าแคมเปญนี้ทันทีที่
          ยืนยันในขั้นถัดไป เพื่อติดตาม/บำรุงรักษาอุปกรณ์เป็นกลุ่ม ยังไม่มี
          canary / ทยอยส่งเป็นชุด (batch) / auto-pause ในเวอร์ชันนี้
        </p>
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onBack}>
          ← ย้อนกลับ
        </Button>
        <Button onClick={onNext}>ถัดไป: ตรวจสอบ & ยืนยัน →</Button>
      </div>
    </div>
  );
}

function ReviewStep({
  name,
  description,
  payloadType,
  config,
  firmware,
  targets,
  incompatibleCount,
  submitting,
  formError,
  onBack,
  onSubmit,
}: {
  name: string;
  description: string;
  payloadType: CampaignPayloadType;
  config: Config | null;
  firmware: Firmware | null;
  targets: {
    deviceId: string;
    device: Device | null;
  }[];
  incompatibleCount: number;
  submitting: boolean;
  formError: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div>
          <p className="text-sm text-muted-foreground">ชื่อแคมเปญ</p>
          <p className="text-sm font-medium">{name.trim() || "—"}</p>
        </div>
        {description.trim() && (
          <div>
            <p className="text-sm text-muted-foreground">คำอธิบาย</p>
            <p className="text-sm">{description.trim()}</p>
          </div>
        )}
        <div>
          <p className="text-sm text-muted-foreground">Payload</p>
          {payloadType === "Config" ? (
            <p className="text-sm font-medium">
              Config: {config?.name ?? "—"}{" "}
              {config && (
                <span className="text-muted-foreground">
                  ({config.deviceModel}/{config.protocol})
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm font-medium">
              Firmware: {firmware ? `v${firmware.version}` : "—"}{" "}
              {firmware && (
                <span className="text-muted-foreground">
                  (รองรับ: {firmware.deviceModelCompatibility.join(", ")})
                </span>
              )}
            </p>
          )}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Rollout</p>
          <p className="text-sm">ส่งพร้อมกันหมด</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <p className="text-sm font-medium">
          อุปกรณ์เป้าหมาย ({targets.length})
        </p>
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left">เลขเครื่อง</th>
                <th className="px-2 py-2 text-left">รุ่น/โปรโตคอล</th>
                <th className="px-2 py-2 text-left">ลูกค้า</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.deviceId} className="border-t">
                  <td className="px-2 py-2 font-mono text-xs">
                    {t.deviceId}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {t.device
                      ? `${t.device.deviceModel} / ${t.device.protocol}`
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {t.device?.customer ? (
                      t.device.customer.companyName
                    ) : (
                      <span className="italic">{UNASSIGNED_CUSTOMER}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {incompatibleCount > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            มีอุปกรณ์ {incompatibleCount} เครื่องที่
            {payloadType === "Config"
              ? "รุ่น/โปรโตคอลไม่ตรงกับ Config"
              : "รุ่นไม่อยู่ในรายการที่ Firmware รองรับ"}{" "}
            — ระบบจะปฏิเสธการยืนยันนี้
          </div>
        )}
      </div>

      {formError && <ErrorBanner message={formError} />}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onBack} disabled={submitting}>
          ← ย้อนกลับ
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "กำลังสร้างแคมเปญ…" : "ยืนยัน — สร้างแคมเปญ"}
        </Button>
      </div>
    </div>
  );
}
