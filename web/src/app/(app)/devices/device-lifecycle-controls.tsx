"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BanIcon,
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  FormBody,
  FormDialogHeader,
  FormFooter,
  FormSection,
} from "@/components/form-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCustomers } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api";
import {
  decommissionDevice,
  reactivateDevice,
  updateDevice,
  type Device,
  type UpdateDeviceInput,
} from "@/lib/device-api";
import { formatDateTime } from "@/lib/format-date";
import { canRegisterDevice } from "@/lib/permissions";

/**
 * วงจรชีวิตของอุปกรณ์หลังลงทะเบียน (มติ A 2026-11-05): แก้ไขข้อมูล · ปลดระวาง · เปิดใช้กลับ —
 * Admin/SuperAdmin เท่านั้น (gate เป็น UX เท่านั้น backend `PermissionGuard` บังคับสิทธิ์จริง ·
 * resource `device-registration` Update เหมือน rotate-key / confirm-install)
 */

/** แถบบอกว่าเครื่องนี้ปลดระวางแล้ว พร้อมเวลาและเหตุผล (ทุก Role เห็น) */
export function DecommissionedNotice({ device }: { device: Device }) {
  if (device.status !== "decommissioned") return null;
  return (
    <Notice tone="warning">
      <BanIcon className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          เครื่องนี้ปลดระวางแล้ว
          {device.decommissionedAt
            ? ` เมื่อ ${formatDateTime(device.decommissionedAt)}`
            : ""}
        </span>
        {device.decommissionReason && (
          <span>เหตุผล: {device.decommissionReason}</span>
        )}
        <span>
          กล่องคุยกับระบบไม่ได้ และแก้ไขข้อมูลไม่ได้ · ประวัติทั้งหมดยังอยู่ ·
          ถ้าเครื่องกลับมาใช้งาน ให้เปิดใช้งานกลับ (IMEI / Serial / Blackbox ID
          ยังเป็นของเครื่องนี้ ลงทะเบียนใหม่เป็นเครื่องที่สองไม่ได้)
        </span>
      </div>
    </Notice>
  );
}

/** ค่าใน input เทียบกับค่าเดิม: ไม่เปลี่ยน = undefined · ช่องที่บังคับกรอกห้ามล้างเป็นค่าว่าง */
function diffRequired(
  label: string,
  original: string | null,
  typed: string,
): { value?: string; error?: string } {
  const next = typed.trim();
  if (next === (original ?? "")) return {};
  if (next === "") return { error: `${label} ห้ามเว้นว่าง` };
  return { value: next };
}

export function EditDeviceControl({
  device,
  onUpdated,
}: {
  device: Device;
  onUpdated: () => void;
}) {
  const { session } = useAuth();
  // เฉพาะลูกค้าที่ใช้งานอยู่ (เปลี่ยนไปผูกลูกค้าที่ปิดใช้งานไม่ได้) · ลูกค้าปัจจุบันของเครื่องแสดงชื่อได้เสมอ
  const { data: customers } = useCustomers({ activeOnly: true });
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [simNumber, setSimNumber] = useState(device.simNumber);
  const [hardwareRevisionCode, setHardwareRevisionCode] = useState(
    device.hardwareRevisionCode ?? "",
  );
  const [imei, setImei] = useState(device.imei ?? "");
  const [serialNumber, setSerialNumber] = useState(device.serialNumber ?? "");
  const [blackboxId, setBlackboxId] = useState(device.blackboxId ?? "");
  const [customerId, setCustomerId] = useState(device.customer?.id ?? "");

  const customerOptions = useMemo(() => {
    const list = customers ?? [];
    const current = device.customer;
    return current && !list.some((c) => c.id === current.id)
      ? [{ id: current.id, companyName: `${current.companyName} (ปิดใช้งานอยู่)` }, ...list]
      : list;
  }, [customers, device.customer]);

  if (!canRegisterDevice(session?.role)) return null;
  if (device.status === "decommissioned") return null;

  // รวบรวมเฉพาะ field ที่เปลี่ยนจริง (ส่งค่าเดิมไปไม่มีประโยชน์ และ backend ไม่เขียน AuditLog ถ้าไม่เปลี่ยน)
  function buildChanges(): { input: UpdateDeviceInput; error: string | null } {
    const input: UpdateDeviceInput = {};
    const checks: [keyof UpdateDeviceInput, string, string | null, string][] = [
      ["simNumber", "SIM Number", device.simNumber, simNumber],
      ["imei", "IMEI", device.imei, imei],
      ["serialNumber", "Serial Number", device.serialNumber, serialNumber],
      ["blackboxId", "Blackbox ID", device.blackboxId, blackboxId],
    ];
    for (const [key, label, original, typed] of checks) {
      const { value, error } = diffRequired(label, original, typed);
      if (error) return { input, error };
      if (value !== undefined) (input as Record<string, string>)[key] = value;
    }
    const rev = hardwareRevisionCode.trim();
    if (rev !== (device.hardwareRevisionCode ?? "")) {
      input.hardwareRevisionCode = rev === "" ? null : rev;
    }
    if (customerId && customerId !== device.customer?.id) {
      input.customerId = customerId;
    }
    return { input, error: null };
  }

  const { input, error: validationError } = buildChanges();
  const hasChanges = Object.keys(input).length > 0;

  async function submit() {
    if (!session?.accessToken || validationError || !hasChanges) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await updateDevice(session.accessToken, device.deviceId, input);
      toast.success(`แก้ข้อมูล "${device.deviceId}" แล้ว`);
      setOpen(false);
      onUpdated();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "แก้ข้อมูลอุปกรณ์ไม่สำเร็จ";
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // เปิดทีไรเริ่มจากค่าปัจจุบันของเครื่องทุกครั้ง (ข้อมูลอาจถูกแก้จากที่อื่นหรือหลังบันทึกรอบก่อน)
          setSimNumber(device.simNumber);
          setHardwareRevisionCode(device.hardwareRevisionCode ?? "");
          setImei(device.imei ?? "");
          setSerialNumber(device.serialNumber ?? "");
          setBlackboxId(device.blackboxId ?? "");
          setCustomerId(device.customer?.id ?? "");
          setFormError(null);
          setOpen(true);
        }}
      >
        <PencilIcon className="size-4" />
        แก้ไขข้อมูล
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 p-0 pb-0 sm:max-w-xl sm:pb-0">
          <FormDialogHeader
            icon={PencilIcon}
            title={`แก้ไขข้อมูล ${device.deviceId}`}
            description="Device ID โมเดล และโปรโตคอลแก้ไม่ได้ · IMEI / Serial / Blackbox ID ห้ามซ้ำกับเครื่องอื่นแม้เครื่องนั้นปลดระวางแล้ว"
          />
          <div className="flex flex-col">
            <FormBody>
              <FormSection title="เลขประจำตัวเครื่อง">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-sim">SIM Number</Label>
                    <Input
                      id="edit-sim"
                      value={simNumber}
                      disabled={submitting}
                      maxLength={50}
                      onChange={(e) => setSimNumber(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-imei">IMEI</Label>
                    <Input
                      id="edit-imei"
                      value={imei}
                      disabled={submitting}
                      maxLength={50}
                      onChange={(e) => setImei(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-serial">Serial Number</Label>
                    <Input
                      id="edit-serial"
                      value={serialNumber}
                      disabled={submitting}
                      maxLength={50}
                      onChange={(e) => setSerialNumber(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-blackbox">Blackbox ID</Label>
                    <Input
                      id="edit-blackbox"
                      value={blackboxId}
                      disabled={submitting}
                      maxLength={50}
                      onChange={(e) => setBlackboxId(e.target.value)}
                    />
                  </div>
                </div>
              </FormSection>

              <FormSection title="การใช้งาน">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-hw">
                      รหัสรุ่นย่อย{" "}
                      <span className="font-normal text-muted-foreground">
                        (ไม่บังคับ)
                      </span>
                    </Label>
                    <Input
                      id="edit-hw"
                      value={hardwareRevisionCode}
                      disabled={submitting}
                      maxLength={50}
                      onChange={(e) => setHardwareRevisionCode(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="edit-customer">ลูกค้า</Label>
                    <Select
                      value={customerId}
                      onValueChange={(value) => setCustomerId(value ?? "")}
                    >
                      <SelectTrigger
                        id="edit-customer"
                        className="w-full"
                        disabled={submitting}
                      >
                        <SelectValue placeholder="ไม่ระบุ">
                          {(value: string) =>
                            customerOptions.find((c) => c.id === value)
                              ?.companyName ?? "ไม่ระบุ"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {customerOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.companyName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      เปลี่ยนไปลูกค้าอื่นได้ แต่ล้างลูกค้าออกไม่ได้
                    </p>
                  </div>
                </div>
              </FormSection>

              {(validationError || formError) && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {validationError ?? formError}
                </div>
              )}
            </FormBody>

            <FormFooter onCancel={() => setOpen(false)} submitting={submitting}>
              <Button
                disabled={!hasChanges || !!validationError || submitting}
                onClick={() => void submit()}
              >
                {submitting ? "กำลังบันทึก…" : "บันทึก"}
              </Button>
            </FormFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DecommissionControl({
  device,
  online,
  onDone,
}: {
  device: Device;
  /** กล่องออนไลน์อยู่ตอนนี้ไหม (จาก Server กลาง) — เตือนเพิ่มว่าจะคุยกับระบบไม่ได้ทันที */
  online?: boolean;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!canRegisterDevice(session?.role)) return null;
  if (device.status === "decommissioned") return null;

  async function handleConfirm(): Promise<boolean> {
    if (!session?.accessToken) return false;
    setError(null);
    try {
      await decommissionDevice(
        session.accessToken,
        device.deviceId,
        reason.trim(),
      );
      toast.success(`ปลดระวาง "${device.deviceId}" แล้ว`);
      setReason("");
      onDone();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ปลดระวางไม่สำเร็จ");
      return false;
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <BanIcon className="size-4" />
        ปลดระวาง
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`ปลดระวาง ${device.deviceId}?`}
        description={
          <>
            กล่องจะคุยกับระบบไม่ได้ทันที (API key ถูกล้าง) และแก้ไขข้อมูลเครื่องไม่ได้ ·
            ประวัติทั้งหมดยังอยู่ · ซ่อนจากรายการเครื่อง · เปิดใช้งานกลับได้ภายหลัง · ถ้ายังมีงานค้าง
            (คำขอส่งเข้ากล่อง, Rollout, งานของช่าง, คำขอ Override ที่รออนุมัติ) ปลดระวางไม่ได้
            ต้องทำให้จบก่อน
            {online && (
              <span className="mt-2 flex items-start gap-1.5 font-medium text-warning-foreground">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                กล่องนี้ออนไลน์อยู่ตอนนี้
              </span>
            )}
            {error && (
              <span className="mt-2 block text-destructive">{error}</span>
            )}
          </>
        }
        confirmLabel="ยืนยันปลดระวาง"
        destructive
        confirmDisabled={reason.trim() === ""}
        onConfirm={handleConfirm}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="decommission-reason">เหตุผล</Label>
          <textarea
            id="decommission-reason"
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น รถถูกขายแล้ว / กล่องเสียถาวร"
            className="min-h-16 resize-y rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
      </ConfirmDialog>
    </>
  );
}

export function ReactivateControl({
  device,
  onDone,
}: {
  device: Device;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [simNumber, setSimNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!canRegisterDevice(session?.role)) return null;
  if (device.status !== "decommissioned") return null;

  async function handleConfirm(): Promise<boolean> {
    if (!session?.accessToken) return false;
    setError(null);
    try {
      const sim = simNumber.trim();
      const result = await reactivateDevice(
        session.accessToken,
        device.deviceId,
        sim ? { simNumber: sim } : {},
      );
      toast.success(`เปิดใช้งาน "${device.deviceId}" กลับแล้ว`);
      setSimNumber("");
      setNewKey(result.apiKey);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เปิดใช้งานกลับไม่สำเร็จ");
      return false;
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
          setOpen(true);
        }}
      >
        <RotateCcwIcon className="size-4" />
        เปิดใช้งานกลับ
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`เปิดใช้งาน ${device.deviceId} กลับ?`}
        description={
          <>
            เครื่องจะกลับเป็น &quot;ลงทะเบียนแล้ว&quot; (ต้องยืนยันติดตั้งใหม่) และได้ API key ใหม่
            ที่ดูซ้ำไม่ได้ ต้องนำไปติดตั้งที่กล่องเอง · SIM ห้ามซ้ำกับเครื่องที่ใช้งานอยู่
            ถ้า SIM เดิมถูกเครื่องอื่นใช้ไปแล้ว ให้ใส่ SIM ใหม่
            {error && (
              <span className="mt-2 block text-destructive">{error}</span>
            )}
          </>
        }
        confirmLabel="ยืนยันเปิดใช้งานกลับ"
        onConfirm={handleConfirm}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reactivate-sim">
            SIM ใหม่{" "}
            <span className="font-normal text-muted-foreground">
              (ไม่บังคับ ไม่ใส่ = ใช้ SIM เดิม {device.simNumber})
            </span>
          </Label>
          <Input
            id="reactivate-sim"
            value={simNumber}
            maxLength={50}
            onChange={(e) => setSimNumber(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <AlertDialog
        open={newKey !== null}
        onOpenChange={(next) => {
          if (!next) {
            setNewKey(null);
            onDone();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>API Key ใหม่ของ {device.deviceId}</AlertDialogTitle>
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
              className="font-instrument text-xs"
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
