"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { canRegisterDevice } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  registerDevice,
  type RegisterDeviceResult,
} from "@/lib/device-api";
import { useDeviceModels } from "@/hooks/use-device-models";
import { useCustomers } from "@/hooks/use-customers";
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

/**
 * ฟอร์มลงทะเบียนอุปกรณ์ใหม่ — Admin/SuperAdmin เท่านั้น (RBAC_Matrix.md ตาราง
 * 4.1 `registerDevice`, issue #157 PR 1) · `modelId`/`protocol` cascade กัน
 * (เลือกรุ่นก่อนถึงจะเลือก protocol ได้ — ตัวเลือก protocol มาจาก
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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterDeviceResult | null>(null);

  const modelList = useMemo(() => models ?? [], [models]);
  const customerList = useMemo(() => customers ?? [], [customers]);
  const selectedModel = modelList.find((m) => m.id === modelId) ?? null;

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
    setProtocol("");
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
    if (!modelId) {
      setFormError("ต้องเลือกรุ่นอุปกรณ์");
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
        imei: imei.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        blackboxId: blackboxId.trim() || undefined,
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
    !submitting;

  return (
    <div className="flex flex-col gap-4">
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
        <Label htmlFor="device-model">รุ่นอุปกรณ์</Label>
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
          disabled={!selectedModel}
          onValueChange={(value) => setProtocol(value ?? "")}
        >
          <SelectTrigger
            id="device-protocol"
            className="w-full"
            disabled={submitting || !selectedModel}
          >
            <SelectValue placeholder="- เลือกรุ่นก่อน -" />
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="device-hw-revision">
          รหัสรุ่นย่อย (Hardware Revision){" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
        </Label>
        <Input
          id="device-hw-revision"
          value={hardwareRevisionCode}
          disabled={submitting}
          placeholder="เช่น RevA"
          onChange={(e) => setHardwareRevisionCode(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="device-imei">
          IMEI{" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
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
          Serial Number{" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
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
          Blackbox ID{" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
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

      {formError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
        {submitting ? "กำลังลงทะเบียน…" : "ลงทะเบียนอุปกรณ์"}
      </Button>
    </div>
  );
}

/** โชว์ apiKey ที่ได้ครั้งเดียวหลังลงทะเบียนสำเร็จ — ไม่มีทาง GET กลับมาดูซ้ำ
 * ได้อีก บังคับให้ copy ก่อนถึงจะกดไปต่อได้ (ปุ่ม "ไปหน้ารายละเอียด" ไม่ได้
 * ถูก disable จริง แค่เตือนด้วยสีให้เห็นชัด — ผู้ใช้ตัดสินใจเองได้ว่าจด apiKey
 * ไว้แล้วหรือยัง) */
function RegisterDeviceSuccess({ result }: { result: RegisterDeviceResult }) {
  const [copied, setCopied] = useState(false);

  async function copyApiKey() {
    try {
      await navigator.clipboard.writeText(result.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
        <p>
          ลงทะเบียน <strong className="font-mono">{result.deviceId}</strong>{" "}
          สำเร็จแล้ว — เก็บ API key ด้านล่างไว้ให้ดี{" "}
          <strong>ดูซ้ำไม่ได้อีกแล้ว</strong> หลังออกจากหน้านี้
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>API Key</Label>
        <div className="flex items-center gap-2">
          <Input readOnly value={result.apiKey} className="font-mono text-xs" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyApiKey()}
          >
            {copied ? (
              <CheckIcon className="size-4" />
            ) : (
              <CopyIcon className="size-4" />
            )}
          </Button>
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
