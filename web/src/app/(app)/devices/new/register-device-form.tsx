"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { canRegisterDevice } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  registerDevice,
  type RegisterDeviceResult,
} from "@/lib/device-api";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useDeviceModels } from "@/hooks/use-device-models";
import { useCustomers } from "@/hooks/use-customers";
import { useCentralDevices } from "@/hooks/use-central-devices";
import { useDevices } from "@/hooks/use-devices";
import { StatusPill } from "@/lib/status-pill";
import { matchModelIdByHardwareModel } from "@/lib/central-device-display";
import { CopyButton } from "@/components/copy-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_CUSTOMER = "__none__";

/** ค่าชั่วคราวที่ห้ามบันทึกเป็นข้อมูลเครื่องจริง (เผื่อมีคนวางหรือพิมพ์เอง) */
const PLACEHOLDER_PREFIX = "central:";

function findPlaceholderField(fields: [string, string][]): string | null {
  const hit = fields.find(([, value]) =>
    value.toLowerCase().startsWith(PLACEHOLDER_PREFIX),
  );
  return hit ? hit[0] : null;
}

/**
 * ฟอร์มลงทะเบียนอุปกรณ์ใหม่ — Admin/SuperAdmin เท่านั้น (RBAC_Matrix.md ตาราง
 * 4.1 `registerDevice`, issue #157 PR 1) · `modelId`/`protocol` cascade กัน
 * (เลือกโมเดลก่อนถึงจะเลือก protocol ได้ — ตัวเลือก protocol มาจาก
 * `DeviceModel.supportedProtocols` ของรุ่นนั้นตรงๆ ไม่ใช่รายการตายตัว)
 *
 * หลังสร้างสำเร็จสลับไปโชว์ apiKey จริง (`RegisterDeviceSuccess` ด้านล่าง)
 * แทนการ redirect ทันที — apiKey โชว์ได้ครั้งเดียว backend ไม่มีทาง GET
 * กลับมาดูซ้ำได้อีก ต้องให้ผู้ใช้ copy ไปเก็บเองก่อนออกจากหน้านี้
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function RegisterDeviceForm() {
  const { session } = useAuth();
  const { data: models } = useDeviceModels();
  const { data: customers } = useCustomers();
  const { data: central } = useCentralDevices();
  const { data: registeredDevices } = useDevices();

  const [deviceId, setDeviceId] = useState("");
  const [simNumber, setSimNumber] = useState("");
  const [modelId, setModelId] = useState("");
  const [protocol, setProtocol] = useState("");
  const [hardwareRevisionCode, setHardwareRevisionCode] = useState("");
  const [customerId, setCustomerId] = useState(NO_CUSTOMER);
  const [imei, setImei] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [blackboxId, setBlackboxId] = useState("");
  const [bootloader, setBootloader] = useState("");
  const [centralPick, setCentralPick] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterDeviceResult | null>(null);

  // กรอกค้างไว้แล้วออกจากหน้า (รีเฟรช/ปิดแท็บ/กดยกเลิก) ต้องเตือนก่อน · ลงทะเบียนสำเร็จแล้วไม่ต้องเตือน
  const isDirty =
    result === null &&
    [deviceId, simNumber, modelId, hardwareRevisionCode, imei, serialNumber, blackboxId, bootloader].some(
      (v) => v.trim() !== "",
    );
  const { confirmLeave } = useUnsavedChangesWarning(isDirty);

  const modelList = useMemo(() => models ?? [], [models]);
  const customerList = useMemo(() => customers ?? [], [customers]);
  const selectedModel = modelList.find((m) => m.id === modelId) ?? null;
  // กล่องที่ Server กลางรู้จักแต่ยังไม่ได้ลงทะเบียนในระบบเรา (ตัดที่ลงทะเบียนแล้วออก)
  const pickableCentral = useMemo(() => {
    const taken = new Set((registeredDevices ?? []).map((d) => d.deviceId));
    return (central?.devices ?? []).filter((d) => !taken.has(d.deviceId));
  }, [central, registeredDevices]);
  // 1 โมเดลมีได้โปรโตคอลเดียว: เลือกให้แล้วล็อกช่อง (รุ่นเก่าที่ยังมีหลายค่าอยู่
  // ยังเลือกเองได้จนกว่าจะแก้ให้เหลือ 1 ค่า)
  const protocolLocked =
    !selectedModel || selectedModel.supportedProtocols.length === 1;

  if (!canRegisterDevice(session?.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        เฉพาะ Role Admin/SuperAdmin เท่านั้นที่ลงทะเบียนอุปกรณ์ได้
      </p>
    );
  }

  if (result) {
    return <RegisterDeviceSuccess result={result} />;
  }

  function changeModel(nextModelId: string) {
    setModelId(nextModelId);
    // โมเดลมีโปรโตคอลเดียว เลือกให้เลย ไม่ต้องให้ผู้ใช้กดซ้ำ
    const next = modelList.find((m) => m.id === nextModelId);
    const only =
      next && next.supportedProtocols.length === 1
        ? next.supportedProtocols[0]
        : "";
    setProtocol(only);
  }

  // เติมฟอร์มจากกล่องที่ Server กลางรู้จัก เฉพาะค่าที่เป็นความจริงเท่านั้น คือ Device ID และ
  // โมเดล · SIM/IMEI/Serial/Blackbox กล่องไม่ได้รายงาน **ปล่อยว่างให้กรอกเอง** ไม่เติมค่า
  // ชั่วคราว เพราะระบบไม่มีทางแก้ข้อมูลเครื่องหลังลงทะเบียน ค่าที่ลืมแก้จะค้างเป็นข้อมูลจริงถาวร
  function prefillFromCentral(id: string) {
    setCentralPick(id);
    const picked = pickableCentral.find((d) => d.deviceId === id);
    if (!picked) return;
    setDeviceId(picked.deviceId);
    const matched = matchModelIdByHardwareModel(picked.hardwareModel, modelList);
    if (matched) changeModel(matched);
  }

  async function onSubmit() {
    if (!session?.accessToken) return;
    const trimmedDeviceId = deviceId.trim();
    const trimmedSimNumber = simNumber.trim();
    if (!trimmedDeviceId) {
      setFormError("ต้องระบุ Device ID");
      return;
    }
    if (!trimmedSimNumber) {
      setFormError("ต้องระบุ SIM Number");
      return;
    }
    const trimmedImei = imei.trim();
    const trimmedSerial = serialNumber.trim();
    const trimmedBlackbox = blackboxId.trim();
    // กันชั้นที่สอง: ค่าที่ขึ้นต้นด้วย `central:` (เช่น วางมาจากที่อื่น) ห้ามถูกบันทึกเป็นข้อมูลจริง
    const placeholderField = findPlaceholderField([
      ["SIM Number", trimmedSimNumber],
      ["IMEI", trimmedImei],
      ["Serial Number", trimmedSerial],
      ["Blackbox ID", trimmedBlackbox],
    ]);
    if (placeholderField) {
      setFormError(
        `ช่อง ${placeholderField} ยังเป็นค่าชั่วคราวที่ขึ้นต้นด้วย central: กรุณากรอกค่าจริงของเครื่อง`,
      );
      return;
    }
    if (!trimmedImei) {
      setFormError("ต้องระบุ IMEI");
      return;
    }
    if (!trimmedSerial) {
      setFormError("ต้องระบุ Serial Number");
      return;
    }
    if (!trimmedBlackbox) {
      setFormError("ต้องระบุ Blackbox ID");
      return;
    }
    if (!modelId) {
      setFormError("ต้องเลือกโมเดล");
      return;
    }
    if (!protocol) {
      setFormError("ต้องเลือกโปรโตคอล");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const registered = await registerDevice(session.accessToken, {
        deviceId: trimmedDeviceId,
        simNumber: trimmedSimNumber,
        modelId,
        protocol,
        hardwareRevisionCode: hardwareRevisionCode.trim() || undefined,
        customerId: customerId !== NO_CUSTOMER ? customerId : undefined,
        imei: trimmedImei,
        serialNumber: trimmedSerial,
        blackboxId: trimmedBlackbox,
        bootloader: bootloader.trim() || undefined,
      });
      toast.success(`ลงทะเบียน "${registered.deviceId}" แล้ว`);
      setResult(registered);
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError ? err.message : "ลงทะเบียนอุปกรณ์ไม่สำเร็จ";
      setFormError(message);
      toast.error(message);
    }
  }

  const canSubmit =
    deviceId.trim() !== "" &&
    simNumber.trim() !== "" &&
    modelId !== "" &&
    protocol !== "" &&
    imei.trim() !== "" &&
    serialNumber.trim() !== "" &&
    blackboxId.trim() !== "" &&
    !submitting;

  return (
    <div className="flex flex-col gap-8">
      {/* 2 คอลัมน์ — mirror pattern "สร้างใหม่" หน้าอื่น (users/new,
       * device-models/new) กันพื้นที่ว่างเปล่าตอนจอกว้าง (แก้ครั้งที่ 71
       * ครอบคลุมหน้าอื่นไปแล้ว หน้านี้ตกหล่นเพราะพัฒนาคนละ branch ขนานกัน) */}
      {central && (
        <section className="flex flex-col gap-2 rounded-lg border bg-surface-sunken p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="central-pick">
              เลือกจาก Server กลาง{" "}
              <span className="font-normal text-muted-foreground">
                (ไม่บังคับ)
              </span>
            </Label>
            {central.mode === "mock" && (
              <StatusPill tone="info">ข้อมูลตัวอย่าง</StatusPill>
            )}
          </div>
          {!central.reachable ? (
            <p className="text-sm text-muted-foreground">
              ติดต่อ Server กลางไม่ได้ตอนนี้ กรอกข้อมูลเองได้ตามปกติ
            </p>
          ) : pickableCentral.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              ไม่มีกล่องใหม่ที่ Server กลางรู้จักและยังไม่ได้ลงทะเบียน
            </p>
          ) : (
            <>
              <Select
                value={centralPick}
                onValueChange={(value) => prefillFromCentral(value ?? "")}
              >
                <SelectTrigger
                  id="central-pick"
                  className="w-full max-w-sm"
                  disabled={submitting}
                >
                  <SelectValue placeholder="- เลือกกล่องเพื่อเติมข้อมูลให้ -" />
                </SelectTrigger>
                <SelectContent>
                  {pickableCentral.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.deviceId} ({d.online ? "ออนไลน์" : "ออฟไลน์"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                เติม Device ID และโมเดลให้ ส่วน SIM, IMEI, Serial และ Blackbox ID
                กล่องไม่ได้รายงาน ต้องกรอกเอง
              </p>
            </>
          )}
        </section>
      )}
      <section className="flex flex-col gap-4">
        <h2 className="border-b pb-2 text-base font-semibold">ข้อมูลตัวเครื่อง</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-id">Device ID</Label>
            <Input
              id="device-id"
              value={deviceId}
              disabled={submitting}
              placeholder="เช่น DEV-0099"
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-sim">SIM Number</Label>
            <Input
              id="device-sim"
              value={simNumber}
              disabled={submitting}
              onChange={(e) => setSimNumber(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-imei">
              IMEI
            </Label>
            <Input
              id="device-imei"
              value={imei}
              disabled={submitting}
              onChange={(e) => setImei(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-serial">
              Serial Number
            </Label>
            <Input
              id="device-serial"
              value={serialNumber}
              disabled={submitting}
              onChange={(e) => setSerialNumber(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-blackbox">
              Blackbox ID
            </Label>
            <Input
              id="device-blackbox"
              value={blackboxId}
              disabled={submitting}
              onChange={(e) => setBlackboxId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-bootloader">
              Bootloader{" "}
              <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
            </Label>
            <Input
              id="device-bootloader"
              value={bootloader}
              disabled={submitting}
              onChange={(e) => setBootloader(e.target.value)}
            />
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="border-b pb-2 text-base font-semibold">ข้อมูลโมเดล</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-model">โมเดล</Label>
            <Select
              value={modelId}
              onValueChange={(value) => changeModel(value ?? "")}
            >
              <SelectTrigger id="device-model" className="w-full" disabled={submitting}>
                <SelectValue placeholder="- เลือก -">
                  {(value: string) =>
                    modelList.find((m) => m.id === value)?.name ?? value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {m.status === "discontinued" ? " (เลิกผลิตแล้ว)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="device-protocol">โปรโตคอล</Label>
            <Select
              value={protocol}
              disabled={protocolLocked}
              onValueChange={(value) => setProtocol(value ?? "")}
            >
              <SelectTrigger
                id="device-protocol"
                className="w-full"
                disabled={submitting || protocolLocked}
              >
                <SelectValue placeholder="- เลือกโมเดลก่อน -" />
              </SelectTrigger>
              <SelectContent>
                {(selectedModel?.supportedProtocols ?? []).map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="device-hw-revision">
              รหัสรุ่นย่อย (Hardware Revision){" "}
              <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
            </Label>
            <Input
              id="device-hw-revision"
              value={hardwareRevisionCode}
              disabled={submitting}
              placeholder="เว้นว่างถ้าไม่มี เช่น RevA"
              onChange={(e) => setHardwareRevisionCode(e.target.value)}
            />
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="border-b pb-2 text-base font-semibold">การใช้งาน</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="device-customer">
              ลูกค้า{" "}
              <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
            </Label>
            <Select
              value={customerId}
              onValueChange={(value) => setCustomerId(value ?? NO_CUSTOMER)}
            >
              <SelectTrigger id="device-customer" className="w-full" disabled={submitting}>
                <SelectValue>
                  {(value: string) =>
                    value === NO_CUSTOMER
                      ? "ไม่ระบุ"
                      : (customerList.find((c) => c.id === value)?.companyName ??
                        "ไม่ระบุ")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CUSTOMER}>ไม่ระบุ</SelectItem>
                {customerList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {formError && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Link
          href="/devices"
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault();
          }}
          className={buttonVariants({ variant: "outline" })}
        >
          ยกเลิก
        </Link>
        <Button disabled={!canSubmit} loading={submitting} onClick={() => void onSubmit()}>
          {submitting ? "กำลังลงทะเบียน…" : "ลงทะเบียนอุปกรณ์"}
        </Button>
      </div>
    </div>
  );
}

/** โชว์ apiKey ที่ได้ครั้งเดียวหลังลงทะเบียนสำเร็จ — ไม่มีทาง GET กลับมาดูซ้ำ
 * ได้อีก บังคับให้ copy ก่อนถึงจะกดไปต่อได้ (ปุ่ม "ไปหน้ารายละเอียด" ไม่ได้
 * ถูก disable จริง แค่เตือนด้วยสีให้เห็นชัด — ผู้ใช้ตัดสินใจเองได้ว่าจด apiKey
 * ไว้แล้วหรือยัง) */
function RegisterDeviceSuccess({ result }: { result: RegisterDeviceResult }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-sm text-warning-foreground">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
        <p>
          ลงทะเบียน <strong className="font-instrument">{result.deviceId}</strong>{" "}
          สำเร็จแล้ว เก็บ API key ด้านล่างไว้ให้ดี{" "}
          <strong>ดูซ้ำไม่ได้อีกแล้ว</strong> หลังออกจากหน้านี้
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>API Key</Label>
        <div className="flex items-center gap-2">
          <Input readOnly value={result.apiKey} className="font-instrument text-xs" />
          <CopyButton value={result.apiKey} label="คัดลอก API Key" />
        </div>
      </div>

      <div className="flex gap-2">
        <Link
          href={`/devices/${encodeURIComponent(result.deviceId)}`}
          className={buttonVariants({ size: "sm" })}
        >
          ไปหน้ารายละเอียดอุปกรณ์
        </Link>
        <Link
          href="/devices/new"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          ลงทะเบียนอีกเครื่อง
        </Link>
      </div>
    </div>
  );
}
