"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { createCampaign, type CampaignTargetInput } from "@/lib/campaign-api";
import type { Config } from "@/lib/config-api";
import type { Device } from "@/lib/device-api";
import type { UserSummary } from "@/lib/users-api";
import { useConfigs } from "@/hooks/use-configs";
import { useDevices } from "@/hooks/use-devices";
import { useFieldTechnicians } from "@/hooks/use-field-technicians";

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

/** Config สถานะที่ใช้สร้างแคมเปญได้ — ตรงกับ `APPLICABLE_CONFIG_STATUSES`
 * ฝั่ง backend (mirror device.service.ts/campaign.service.ts) */
const CAMPAIGN_ELIGIBLE_CONFIG_STATUSES = ["approved", "synced"];

const STEPS = [
  { n: 1, label: "เลือกเป้าหมาย" },
  { n: 2, label: "เลือก Payload" },
  { n: 3, label: "Rollout" },
  { n: 4, label: "ตรวจสอบ & ยืนยัน" },
] as const;

type Step = (typeof STEPS)[number]["n"];

/**
 * Campaign Wizard (Sprint 3 #21) — สร้างแคมเปญใหม่ 4 ขั้น ตาม wireframe ที่
 * พี่เลี้ยง approve ไว้แต่แรก (เลือกเป้าหมาย+มอบหมาย / เลือก Payload / Rollout
 * / ตรวจสอบ&ยืนยัน — เดิมขั้นสุดท้ายชื่อ "ส่งอนุมัติ" แต่เปลี่ยนเป็น "ยืนยัน"
 * เพราะ `CampaignStatus` ไม่มี approval workflow แยกแบบ Config)
 *
 * v1 = "ส่งพร้อมกันหมด" ล้วน (ไม่มี rollout strategy ให้เลือก) และรองรับแค่
 * `payloadType: Config` (Firmware ยังไม่มี backend module ให้เลือก เลือกไม่ได้
 * ในฟอร์มนี้เลย — ตรงกับที่ backend คืน 400 ถ้าฝืนส่งมา)
 */
export function CampaignWizard() {
  const router = useRouter();
  const { session } = useAuth();

  const devicesQuery = useDevices();
  const configsQuery = useConfigs();
  const techniciansQuery = useFieldTechnicians();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  // deviceId -> assignedTo user id ("" = ยังไม่มอบหมาย)
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [configId, setConfigId] = useState("");

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

  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return installedDevices;
    return installedDevices.filter(
      (d) =>
        d.deviceId.toLowerCase().includes(q) ||
        d.deviceModel.toLowerCase().includes(q),
    );
  }, [installedDevices, search]);

  const eligibleConfigs = useMemo(
    () =>
      (configsQuery.data ?? []).filter((c) =>
        CAMPAIGN_ELIGIBLE_CONFIG_STATUSES.includes(c.status),
      ),
    [configsQuery.data],
  );

  const selectedDeviceIds = Object.keys(targets);
  const selectedConfig = eligibleConfigs.find((c) => c.id === configId) ?? null;
  const deviceByDeviceId = useMemo(
    () => new Map(installedDevices.map((d) => [d.deviceId, d])),
    [installedDevices],
  );

  /** เครื่องที่เลือกไว้แต่ deviceModel/protocol ไม่ตรงกับ Config ที่เลือก —
   * เตือนไว้ก่อนล่วงหน้า (backend เช็คซ้ำอยู่ดีตอน submit เป็น 409) */
  const incompatibleTargets = useMemo(() => {
    if (!selectedConfig) return [] as string[];
    return selectedDeviceIds.filter((deviceId) => {
      const device = deviceByDeviceId.get(deviceId);
      if (!device) return false;
      return (
        device.deviceModel !== selectedConfig.deviceModel ||
        device.protocol !== selectedConfig.protocol
      );
    });
  }, [selectedDeviceIds, selectedConfig, deviceByDeviceId]);

  function toggleDevice(deviceId: string, checked: boolean) {
    setTargets((prev) => {
      const next = { ...prev };
      if (checked) {
        next[deviceId] = prev[deviceId] ?? "";
      } else {
        delete next[deviceId];
      }
      return next;
    });
    clearErrors();
  }

  function setAssignee(deviceId: string, userId: string) {
    setTargets((prev) => ({ ...prev, [deviceId]: userId }));
    clearErrors();
  }

  const unassignedCount = selectedDeviceIds.filter(
    (id) => !targets[id],
  ).length;

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
      if (unassignedCount > 0) {
        setFormError(
          `ยังไม่ได้มอบหมายผู้รับผิดชอบให้ ${unassignedCount} เครื่อง`,
        );
        return;
      }
    }
    if (next === 3 && !configId) {
      setFormError("เลือก Config ก่อน");
      return;
    }
    setStep(next);
  }

  async function handleSubmit() {
    clearErrors();
    if (!session?.accessToken || !configId) return;

    const targetInputs: CampaignTargetInput[] = selectedDeviceIds.map(
      (deviceId) => ({ deviceId, assignedTo: targets[deviceId] }),
    );

    setSubmitting(true);
    try {
      const trimmedDesc = description.trim();
      const created = await createCampaign(session.accessToken, {
        name: name.trim(),
        payloadType: "Config",
        configId,
        targets: targetInputs,
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
      });
      router.push(`/campaigns/${created.id}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        setFormError(err.message);
        return;
      }
      setFormError("สร้างแคมเปญไม่สำเร็จ");
    }
  }

  const loadingInitial =
    (devicesQuery.isLoading && !devicesQuery.data) ||
    (configsQuery.isLoading && !configsQuery.data) ||
    (techniciansQuery.isLoading && !techniciansQuery.data);

  const loadError =
    devicesQuery.error ?? configsQuery.error ?? techniciansQuery.error;

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
            void techniciansQuery.refetch();
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
          devices={filteredDevices}
          technicians={techniciansQuery.data ?? []}
          targets={targets}
          onToggleDevice={toggleDevice}
          onSetAssignee={setAssignee}
          formError={formError}
          onCancel={() => router.push("/campaigns")}
          onNext={() => goToStep(2)}
        />
      )}

      {step === 2 && (
        <PayloadStep
          configs={eligibleConfigs}
          configId={configId}
          onSelectConfig={(v) => {
            setConfigId(v);
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
          config={selectedConfig}
          targets={selectedDeviceIds.map((deviceId) => ({
            deviceId,
            device: deviceByDeviceId.get(deviceId) ?? null,
            assignee:
              (techniciansQuery.data ?? []).find(
                (u) => u.id === targets[deviceId],
              ) ?? null,
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
  devices,
  technicians,
  targets,
  onToggleDevice,
  onSetAssignee,
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
  devices: Device[];
  technicians: UserSummary[];
  targets: Record<string, string>;
  onToggleDevice: (deviceId: string, checked: boolean) => void;
  onSetAssignee: (deviceId: string, userId: string) => void;
  formError: string | null;
  onCancel: () => void;
  onNext: () => void;
}) {
  const selectedCount = Object.keys(targets).length;

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
            <p className="text-sm font-medium">
              เลือกอุปกรณ์เป้าหมาย + มอบหมายผู้รับผิดชอบหน้างาน
            </p>
            <p className="text-xs text-muted-foreground">
              ติ๊กช่องซ้ายมือหรือคลิกที่แถวเพื่อเลือก/ยกเลิก · เฉพาะอุปกรณ์
              สถานะ installed เท่านั้น · เลือกแล้ว {selectedCount} เครื่อง
            </p>
          </div>
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ค้นหาเลขเครื่อง/รุ่น…"
            className="h-8 max-w-52"
          />
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
                  <th className="px-2 py-2 text-left">ผู้รับผิดชอบหน้างาน</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const checked = device.deviceId in targets;
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
                      <td
                        className="px-2 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={targets[device.deviceId] ?? ""}
                          disabled={!checked}
                          onChange={(e) =>
                            onSetAssignee(device.deviceId, e.target.value)
                          }
                          className={SELECT_CLASS}
                        >
                          <option value="">— เลือกช่างหน้างาน —</option>
                          {technicians.map((tech) => (
                            <option key={tech.id} value={tech.id}>
                              {tech.fullName} ({tech.role})
                            </option>
                          ))}
                        </select>
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

function PayloadStep({
  configs,
  configId,
  onSelectConfig,
  incompatibleCount,
  formError,
  onBack,
  onNext,
}: {
  configs: Config[];
  configId: string;
  onSelectConfig: (id: string) => void;
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
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
              Config
            </span>
            <span
              className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground"
              title="ยังไม่รองรับ — ยังไม่มี backend firmware module ให้เลือก"
            >
              Firmware (ยังไม่รองรับ)
            </span>
          </div>
        </div>

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

        {incompatibleCount > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            มีอุปกรณ์เป้าหมาย {incompatibleCount} เครื่องที่รุ่น/โปรโตคอลไม่ตรง
            กับ Config นี้ — ระบบจะปฏิเสธตอนยืนยัน ย้อนกลับไปแก้เป้าหมายหรือ
            เปลี่ยน Config ก่อน
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
          เท่านั้น — ทุกเครื่องได้รับ Task ทันทีที่ยืนยันในขั้นถัดไป ยังไม่มี
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
  config,
  targets,
  incompatibleCount,
  submitting,
  formError,
  onBack,
  onSubmit,
}: {
  name: string;
  description: string;
  config: Config | null;
  targets: {
    deviceId: string;
    device: Device | null;
    assignee: UserSummary | null;
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
          <p className="text-sm font-medium">
            Config: {config?.name ?? "—"}{" "}
            {config && (
              <span className="text-muted-foreground">
                ({config.deviceModel}/{config.protocol})
              </span>
            )}
          </p>
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
                <th className="px-2 py-2 text-left">ผู้รับผิดชอบ</th>
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
                  <td className="px-2 py-2">
                    {t.assignee ? `${t.assignee.fullName} (${t.assignee.role})` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {incompatibleCount > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            มีอุปกรณ์ {incompatibleCount} เครื่องที่รุ่น/โปรโตคอลไม่ตรงกับ
            Config — ระบบจะปฏิเสธการยืนยันนี้
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
