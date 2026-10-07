"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { XIcon } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { canManageDeviceModels } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  createDeviceModel,
  type DeviceModelStatus,
} from "@/lib/device-model-api";
import { pillClass } from "@/lib/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * ฟอร์มสร้างรุ่นอุปกรณ์ใหม่ — Admin/SuperAdmin เท่านั้น (RBAC_Matrix.md ตาราง
 * 4.1 `createDeviceModel`) · chip input ของ `supportedProtocols` mirror
 * `EditCompatibilityForm` (add/remove chip เดิมของ Firmware Compatibility Tag)
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function CreateDeviceModelForm() {
  const { session } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [protocols, setProtocols] = useState<string[]>([]);
  const [protocolDraft, setProtocolDraft] = useState("");
  const [status, setStatus] = useState<DeviceModelStatus>("active");
  const [warrantyMonths, setWarrantyMonths] = useState("");
  const [endOfSupportDate, setEndOfSupportDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!canManageDeviceModels(session?.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        เฉพาะ Role Admin/SuperAdmin เท่านั้นที่เพิ่มรุ่นอุปกรณ์ได้
      </p>
    );
  }

  function addProtocol() {
    const trimmed = protocolDraft.trim();
    if (!trimmed || protocols.includes(trimmed)) {
      setProtocolDraft("");
      return;
    }
    setProtocols((prev) => [...prev, trimmed]);
    setProtocolDraft("");
  }

  function removeProtocol(protocol: string) {
    setProtocols((prev) => prev.filter((p) => p !== protocol));
  }

  async function onSubmit() {
    if (!session?.accessToken) return;
    const trimmedName = name.trim();
    const trimmedManufacturer = manufacturer.trim();
    const trimmedNotes = notes.trim();
    if (!trimmedName) {
      setFormError("ต้องระบุชื่อรุ่น");
      return;
    }
    if (protocols.length === 0) {
      setFormError("ต้องระบุ Protocol ที่รองรับอย่างน้อย 1 รายการ");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createDeviceModel(session.accessToken, {
        name: trimmedName,
        manufacturer: trimmedManufacturer || undefined,
        supportedProtocols: protocols,
        status,
        warrantyMonths: warrantyMonths ? Number(warrantyMonths) : undefined,
        endOfSupportDate: endOfSupportDate || undefined,
        notes: trimmedNotes || undefined,
      });
      toast.success(`เพิ่มรุ่นอุปกรณ์ "${created.name}" แล้ว`);
      router.push(`/device-models?created=${encodeURIComponent(created.id)}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError ? err.message : "เพิ่มรุ่นอุปกรณ์ไม่สำเร็จ";
      setFormError(message);
      toast.error(message);
    }
  }

  const canSubmit =
    name.trim() !== "" && protocols.length > 0 && !submitting;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-name">ชื่อรุ่น</Label>
        <Input
          id="model-name"
          value={name}
          disabled={submitting}
          placeholder="เช่น GT06N"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-manufacturer">
          ผู้ผลิต{" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
        </Label>
        <Input
          id="model-manufacturer"
          value={manufacturer}
          disabled={submitting}
          onChange={(e) => setManufacturer(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Protocol ที่รองรับ</Label>
        <div className="flex flex-wrap gap-1.5">
          {protocols.map((p) => (
            <span key={p} className={`${pillClass("neutral")} gap-1 pr-1`}>
              {p}
              <button
                type="button"
                onClick={() => removeProtocol(p)}
                disabled={submitting}
                aria-label={`ลบ protocol ${p}`}
                className="rounded-full hover:bg-black/10 dark:hover:bg-white/10"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          {protocols.length === 0 && (
            <span className="text-xs text-muted-foreground">
              ยังไม่มี protocol ที่รองรับ
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={protocolDraft}
            disabled={submitting}
            placeholder="เช่น TCP"
            className="h-8"
            onChange={(e) => setProtocolDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addProtocol();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={addProtocol}
          >
            เพิ่ม
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>สถานะ</Label>
        <Select
          value={status}
          onValueChange={(value) =>
            setStatus((value as DeviceModelStatus) ?? "active")
          }
        >
          <SelectTrigger className="w-full" disabled={submitting}>
            <SelectValue>
              {(value: string) =>
                value === "discontinued" ? "เลิกผลิตแล้ว" : "ยังผลิตอยู่"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">ยังผลิตอยู่</SelectItem>
            <SelectItem value="discontinued">เลิกผลิตแล้ว</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-warranty">
          รับประกัน (เดือน){" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
        </Label>
        <Input
          id="model-warranty"
          type="number"
          min={0}
          value={warrantyMonths}
          disabled={submitting}
          onChange={(e) => setWarrantyMonths(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-eos">
          สิ้นสุดการซัพพอร์ต{" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
        </Label>
        <Input
          id="model-eos"
          type="date"
          value={endOfSupportDate}
          disabled={submitting}
          onChange={(e) => setEndOfSupportDate(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-notes">
          หมายเหตุ{" "}
          <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
        </Label>
        <textarea
          id="model-notes"
          value={notes}
          disabled={submitting}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={2}
          className="min-h-16 resize-y rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>

      {formError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
        {submitting ? "กำลังเพิ่ม…" : "เพิ่มรุ่นอุปกรณ์"}
      </Button>
    </div>
  );
}
