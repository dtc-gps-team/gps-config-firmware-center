"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useConfigs } from "@/hooks/use-configs";
import { useDevices } from "@/hooks/use-devices";
import { useRolloutDeviceValues } from "@/hooks/use-rollout-device-values";
import { useUserNames } from "@/hooks/use-user-names";
import {
  MAX_DEVICE_VALUES,
  buildDeviceValues,
  continuesAutomatically,
  needsCarryChoice,
  valueToText,
  type CarryChoice,
} from "@/lib/rollout-device-values";
import { useFirmwareList } from "@/hooks/use-firmware";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { describeIncompatibility } from "./rollout-compatibility";
import { RolloutDeviceValuesEditor } from "./rollout-device-values-editor";

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
  const definitionsQuery = useConfigDefinitions();
  const { resolveName } = useUserNames();

  const [payloadType, setPayloadType] = useState<CampaignPayloadType>("Config");
  const [configId, setConfigId] = useState("");
  const [firmwareId, setFirmwareId] = useState("");
  const [excludedDeviceIds, setExcludedDeviceIds] = useState<Set<string>>(
    new Set(),
  );
  // ค่าเฉพาะเครื่อง (docs/17) — ค่าที่แก้เอง (แปลงชนิดแล้ว) และการเลือก
  // "ใช้ค่าพิเศษเดิมต่อ / ใช้ตามแม่แบบใหม่" ต่อเครื่อง
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>(
    {},
  );
  const [choices, setChoices] = useState<
    Record<string, CarryChoice | undefined>
  >({});
  const [valuesReason, setValuesReason] = useState("");
  const [editorDeviceId, setEditorDeviceId] = useState<string | null>(null);
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

  const valuesEnabled = payloadType === "Config" && selectedConfig !== null;
  const deviceValuesQuery = useRolloutDeviceValues(
    campaignId,
    valuesEnabled ? configId : null,
  );
  const valueItems = useMemo(
    () => (valuesEnabled ? (deviceValuesQuery.data ?? []) : []),
    [valuesEnabled, deviceValuesQuery.data],
  );
  const itemByDevice = useMemo(
    () => new Map(valueItems.map((i) => [i.deviceId, i])),
    [valueItems],
  );

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
  const includedDeviceIds = memberDeviceIds.filter(
    (id) => !excludedDeviceIds.has(id) && !incompatibleReasons.has(id),
  );

  /** เปลี่ยน Config แม่แบบ: เก็บค่าที่แก้ไว้เฉพาะ field ที่ Config ใหม่ยังมี
   * ส่วนการเลือกค่าพิเศษเดิมเริ่มใหม่ (ค่าพิเศษเดิมต่างกันตาม Config) */
  function changeConfig(nextConfigId: string) {
    const next = eligibleConfigs.find((c) => c.id === nextConfigId) ?? null;
    setConfigId(nextConfigId);
    setChoices({});
    setEdits((prev) => {
      if (!next) return {};
      const kept: Record<string, Record<string, unknown>> = {};
      for (const [deviceId, fields] of Object.entries(prev)) {
        const stillValid = Object.fromEntries(
          Object.entries(fields).filter(([name]) =>
            Object.hasOwn(next.fields, name),
          ),
        );
        if (Object.keys(stillValid).length > 0) kept[deviceId] = stillValid;
      }
      return kept;
    });
    setFormError(null);
  }

  function saveEdits(deviceId: string, fields: Record<string, unknown>) {
    setEdits((prev) => {
      const next = { ...prev };
      if (Object.keys(fields).length === 0) {
        delete next[deviceId];
      } else {
        next[deviceId] = fields;
      }
      return next;
    });
    setFormError(null);
  }

  /** ค่าสุดท้ายต่อเครื่องที่จะส่ง (เฉพาะเครื่องที่ยังอยู่ใน Rollout) */
  const valuesResult = useMemo(
    () =>
      valuesEnabled
        ? buildDeviceValues({
            configId,
            includedDeviceIds,
            items: valueItems,
            edits,
            choices,
          })
        : { values: [], missingChoices: [], blocked: [] },
    [valuesEnabled, configId, includedDeviceIds, valueItems, edits, choices],
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
      setFormError(
        incompatibleReasons.size > 0
          ? "ไม่มีเครื่องไหนในกลุ่มที่เข้ากันกับ payload นี้ เลือก payload อื่น"
          : "ต้องเหลืออุปกรณ์อย่างน้อย 1 เครื่องใน Rollout นี้",
      );
      return;
    }

    if (valuesResult.missingChoices.length > 0) {
      setFormError(
        `เลือกวิธีจัดการค่าพิเศษเดิมให้ครบก่อน ยังไม่ได้เลือก: ${valuesResult.missingChoices.join(", ")}`,
      );
      return;
    }
    if (valuesResult.blocked.length > 0) {
      setFormError(
        `เครื่องต่อไปนี้มีคำขอของช่างรออนุมัติอยู่ ตั้งค่าเฉพาะเครื่องไม่ได้จนกว่าจะตัดสินใจคำขอนั้น: ${valuesResult.blocked.join(", ")}`,
      );
      return;
    }
    if (valuesResult.values.length > MAX_DEVICE_VALUES) {
      setFormError(
        `ตั้งค่าเฉพาะเครื่องได้ไม่เกิน ${MAX_DEVICE_VALUES} เครื่องต่อ Rollout`,
      );
      return;
    }
    if (valuesResult.values.length > 0 && valuesReason.trim() === "") {
      setFormError("กรอกเหตุผลของค่าเฉพาะเครื่อง");
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
          ...(valuesResult.values.length > 0
            ? {
                deviceValues: valuesResult.values,
                deviceValuesReason: valuesReason.trim(),
              }
            : {}),
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
              onValueChange={(value) => changeConfig(value ?? "")}
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
                    v{f.version}: รองรับ {f.deviceModelCompatibility.join(", ")}
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

      <Card className="gap-3 p-5">
        <div>
          <p className="text-sm font-medium">
            อุปกรณ์ในรอบนี้ ({includedDeviceIds.length}/{memberDeviceIds.length})
          </p>
          <p className="text-xs text-muted-foreground">
            default = สมาชิกทั้งกลุ่ม เอาเครื่องที่ไม่พร้อมออกได้โดยเอาเครื่องหมายถูกออก
            เครื่องที่ไม่เข้ากันกับ payload ที่เลือกจะถูกเอาออกให้อัตโนมัติ
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
                  <TableHead>โมเดล/โปรโตคอล</TableHead>
                  {valuesEnabled && <TableHead>ค่าเฉพาะเครื่อง</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberDeviceIds.map((deviceId) => {
                  const device: Device | undefined =
                    deviceByDeviceId.get(deviceId);
                  const incompatibleReason = incompatibleReasons.get(deviceId);
                  const incompatible = incompatibleReason !== undefined;
                  const included =
                    !incompatible && !excludedDeviceIds.has(deviceId);
                  return (
                    <TableRow
                      key={deviceId}
                      className={incompatible ? "opacity-60" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          checked={included}
                          disabled={incompatible}
                          onCheckedChange={(c) =>
                            toggleExcluded(deviceId, c === true)
                          }
                          aria-label={
                            incompatible
                              ? "เครื่องนี้ไม่เข้ากันกับ payload จึงเลือกไม่ได้"
                              : included
                                ? "เอาเครื่องนี้ออกจาก Rollout"
                                : "เอาเครื่องนี้กลับเข้า Rollout"
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {deviceId}
                        {incompatible && (
                          <p className="mt-0.5 font-sans text-amber-700 dark:text-amber-400">
                            {incompatibleReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {device
                          ? `${device.deviceModel} / ${device.protocol}`
                          : "-"}
                      </TableCell>
                      {valuesEnabled && (
                        <TableCell className="align-top text-xs">
                          {included ? (
                            <DeviceValuesCell
                              deviceId={deviceId}
                              configId={configId}
                              item={itemByDevice.get(deviceId)}
                              editedCount={
                                Object.keys(edits[deviceId] ?? {}).length
                              }
                              choice={choices[deviceId]}
                              loading={deviceValuesQuery.isLoading}
                              resolveName={resolveName}
                              onEdit={() => setEditorDeviceId(deviceId)}
                              onChoose={(c) => {
                                setChoices((prev) => ({
                                  ...prev,
                                  [deviceId]: c,
                                }));
                                setFormError(null);
                              }}
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {valuesEnabled && deviceValuesQuery.error && (
          <ErrorBanner message={deviceValuesQuery.error} />
        )}

        {incompatibleReasons.size > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            จะส่งให้ {includedDeviceIds.length} จาก {memberDeviceIds.length}{" "}
            เครื่อง ส่วนอีก {incompatibleReasons.size} เครื่องไม่เข้ากันกับ{" "}
            {payloadType === "Config" ? "Config" : "Firmware"} ที่เลือก
            ระบบเอาออกจากรอบนี้ให้อัตโนมัติ เครื่องเหล่านั้นต้องส่งในรอบอื่นด้วย{" "}
            {payloadType === "Config" ? "Config" : "Firmware"} ที่ตรงกับโมเดลของเครื่อง
          </div>
        )}
      </Card>

      {valuesResult.values.length > 0 && (
        <Card className="gap-2 p-5">
          <Label htmlFor="rollout-values-reason">
            เหตุผลของค่าเฉพาะเครื่อง ({valuesResult.values.length} เครื่อง)
          </Label>
          <Input
            id="rollout-values-reason"
            value={valuesReason}
            maxLength={1000}
            placeholder="เช่น ลูกค้าขอเพดานความเร็วสูงกว่าปกติสำหรับรถคันนี้"
            onChange={(e) => {
              setValuesReason(e.target.value);
              setFormError(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            ใช้หนึ่งเหตุผลต่อทั้ง Rollout ผู้อนุมัติจะเห็นค่าเฉพาะเครื่องและ
            เหตุผลนี้ก่อนตัดสินใจ ค่าจะมีผลเมื่อ Rollout ถูกปล่อยเข้าอุปกรณ์
          </p>
        </Card>
      )}

      {formError && <ErrorBanner message={formError} />}

      {editorDeviceId && selectedConfig && (
        <RolloutDeviceValuesEditor
          key={editorDeviceId}
          open
          onOpenChange={(open) => {
            if (!open) setEditorDeviceId(null);
          }}
          deviceId={editorDeviceId}
          config={selectedConfig}
          definitions={definitionsQuery.data ?? []}
          baseFields={baseFieldsFor(
            itemByDevice.get(editorDeviceId),
            choices[editorDeviceId],
            configId,
          )}
          edits={edits[editorDeviceId] ?? {}}
          onSave={(fields) => saveEdits(editorDeviceId, fields)}
        />
      )}

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

/** ค่าพิเศษเดิมที่มีผลกับเครื่องนี้อยู่ตอนแก้ค่า: ที่ผู้ใช้เลือกใช้ต่อ หรือที่
 * ผูกกับ Config เดียวกัน (ใช้ต่ออัตโนมัติ) */
function baseFieldsFor(
  item: Parameters<typeof needsCarryChoice>[0],
  choice: CarryChoice | undefined,
  configId: string,
): Record<string, unknown> {
  if (!item?.previous) return {};
  if (continuesAutomatically(item, configId)) return item.previous.fields;
  if (needsCarryChoice(item, configId) && choice === "keep") {
    return item.previous.fields;
  }
  return {};
}

function DeviceValuesCell({
  deviceId,
  configId,
  item,
  editedCount,
  choice,
  loading,
  resolveName,
  onEdit,
  onChoose,
}: {
  deviceId: string;
  configId: string;
  item: Parameters<typeof needsCarryChoice>[0];
  editedCount: number;
  choice: CarryChoice | undefined;
  loading: boolean;
  resolveName: (userId: string) => string;
  onEdit: () => void;
  onChoose: (choice: CarryChoice) => void;
}) {
  if (item?.hasPendingRequest) {
    return (
      <p className="text-amber-700 dark:text-amber-400">
        มีคำขอของช่างรออนุมัติอยู่ ตั้งค่าเฉพาะเครื่องไม่ได้จนกว่า Operation
        จะตัดสินใจคำขอนั้น
      </p>
    );
  }

  const previous = item?.previous ?? null;
  const carryText = previous
    ? Object.entries(previous.fields)
        .map(([name, value]) => `${name} ${valueToText(value)}`)
        .join(", ")
    : "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={editedCount > 0 ? "font-medium" : "text-muted-foreground"}
        >
          {editedCount > 0 ? `แก้ ${editedCount} ค่า` : "ตามแม่แบบ"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onEdit}
          aria-label={`แก้ค่าของ ${deviceId}`}
        >
          แก้ค่า
        </Button>
      </div>

      {needsCarryChoice(item, configId) && previous && (
        <fieldset className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950">
          <legend className="px-1 text-amber-800 dark:text-amber-300">
            เครื่องนี้เคยมีค่าพิเศษ ตั้งโดย {resolveName(previous.overriddenBy)}
          </legend>
          <label className="flex items-start gap-1.5">
            <input
              type="radio"
              name={`carry-${deviceId}`}
              checked={choice === "keep"}
              onChange={() => onChoose("keep")}
            />
            <span>ใช้ค่าพิเศษเดิมต่อ: {carryText}</span>
          </label>
          <label className="flex items-start gap-1.5">
            <input
              type="radio"
              name={`carry-${deviceId}`}
              checked={choice === "template"}
              onChange={() => onChoose("template")}
            />
            <span>ใช้ตามแม่แบบใหม่</span>
          </label>
        </fieldset>
      )}

      {continuesAutomatically(item, configId) && (
        <p className="text-muted-foreground">
          ค่าพิเศษเดิมของ Config นี้ ({carryText}) ยังมีผลต่อ
        </p>
      )}

      {previous && previous.dropped.length > 0 && (
        <p className="text-muted-foreground">
          ใช้กับ Config นี้ไม่ได้จึงไม่ถูกยกมา:{" "}
          {previous.dropped
            .map((d) => `${d.fieldName} (${d.reason})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}
