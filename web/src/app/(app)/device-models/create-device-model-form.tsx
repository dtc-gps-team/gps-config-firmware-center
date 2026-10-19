"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canManageDeviceModels } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  createDeviceModel,
  type DeviceModel,
  type DeviceModelStatus,
} from "@/lib/device-model-api";
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
 * 4.1 `createDeviceModel`) · **1 โมเดลมีได้โปรโตคอลเดียว** (มติรีวิวพี่เลี้ยง
 * 19 ต.ค. 2569) จึงกรอกช่องเดียว ส่งเป็น `supportedProtocols: [ค่าเดียว]`
 * (API ยังเป็น array ตามเดิม)
 *
 * เดิมเป็นหน้าเต็ม `/device-models/new` — ย้ายมาเป็น Dialog (แก้ครั้งที่ 71)
 * เรียก `onCreated` แทน `router.push` เดิม ให้ parent ปิด dialog + refetch เอง
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function CreateDeviceModelForm({
  onCreated,
}: {
  onCreated: (model: DeviceModel) => void;
}) {
  const { session } = useAuth();

  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [protocol, setProtocol] = useState("");
  const [status, setStatus] = useState<DeviceModelStatus>("active");
  const [warrantyMonths, setWarrantyMonths] = useState("");
  const [endOfSupportDate, setEndOfSupportDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!canManageDeviceModels(session?.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        เฉพาะ Role Admin/SuperAdmin เท่านั้นที่เพิ่มโมเดลได้
      </p>
    );
  }

  async function onSubmit() {
    if (!session?.accessToken) return;
    const trimmedName = name.trim();
    const trimmedManufacturer = manufacturer.trim();
    const trimmedNotes = notes.trim();
    if (!trimmedName) {
      setFormError("ต้องระบุชื่อโมเดล");
      return;
    }
    const trimmedProtocol = protocol.trim();
    if (!trimmedProtocol) {
      setFormError("ต้องระบุโปรโตคอล");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createDeviceModel(session.accessToken, {
        name: trimmedName,
        manufacturer: trimmedManufacturer || undefined,
        supportedProtocols: [trimmedProtocol],
        status,
        warrantyMonths: warrantyMonths ? Number(warrantyMonths) : undefined,
        endOfSupportDate: endOfSupportDate || undefined,
        notes: trimmedNotes || undefined,
      });
      toast.success(`เพิ่มโมเดล "${created.name}" แล้ว`);
      onCreated(created);
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError ? err.message : "เพิ่มโมเดลไม่สำเร็จ";
      setFormError(message);
      toast.error(message);
    }
  }

  const canSubmit =
    name.trim() !== "" && protocol.trim() !== "" && !submitting;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="model-name">ชื่อโมเดล</Label>
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
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-protocol">โปรโตคอล</Label>
        <Input
          id="model-protocol"
          value={protocol}
          disabled={submitting}
          placeholder="เช่น TCP"
          onChange={(e) => setProtocol(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          1 โมเดลมีได้โปรโตคอลเดียว
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
        {submitting ? "กำลังเพิ่ม…" : "เพิ่มโมเดล"}
      </Button>
    </div>
  );
}
