"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canUpdateFirmwareCompatibility } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { updateFirmwareCompatibility, type Firmware } from "@/lib/firmware-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pillClass } from "@/lib/status-pill";

/**
 * แก้ Compatibility Tag ของ Firmware — FirmwareEngineer เท่านั้น (`PATCH /firmware/{id}`)
 * แทนที่ทั้ง array เสมอ (ไม่ merge กับของเดิม — mirror backend) จึงส่ง
 * "รายการเต็มหลังแก้" ทุกครั้งที่กด บันทึก ไม่ใช่แค่ตัวที่เพิ่ม/ลบ
 */
export function EditCompatibilityForm({
  firmware,
  onSaved,
}: {
  firmware: Firmware;
  onSaved: (updated: Firmware) => void;
}) {
  const { session } = useAuth();
  const [editing, setEditing] = useState(false);
  const [models, setModels] = useState<string[]>(firmware.deviceModelCompatibility);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canUpdateFirmwareCompatibility(session?.role)) return null;

  function startEdit() {
    setModels(firmware.deviceModelCompatibility);
    setDraft("");
    setError(null);
    setEditing(true);
  }

  function addModel() {
    const trimmed = draft.trim();
    if (!trimmed || models.includes(trimmed)) {
      setDraft("");
      return;
    }
    setModels((prev) => [...prev, trimmed]);
    setDraft("");
  }

  function removeModel(model: string) {
    setModels((prev) => prev.filter((m) => m !== model));
  }

  async function save() {
    if (!session?.accessToken) return;
    if (models.length === 0) {
      setError("ต้องมีรุ่นอุปกรณ์ที่รองรับอย่างน้อย 1 รุ่น");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateFirmwareCompatibility(
        session.accessToken,
        firmware.id,
        models,
      );
      toast.success("บันทึก Compatibility Tag แล้ว");
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "แก้ Compatibility Tag ไม่สำเร็จ";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <Button size="sm" variant="outline" onClick={startEdit}>
        แก้ Compatibility Tag
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap gap-1.5">
        {models.map((m) => (
          <span
            key={m}
            className={`${pillClass("neutral")} gap-1 pr-1`}
          >
            {m}
            <button
              type="button"
              onClick={() => removeModel(m)}
              disabled={submitting}
              aria-label={`ลบรุ่น ${m}`}
              className="rounded-full hover:bg-black/10 dark:hover:bg-white/10"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        {models.length === 0 && (
          <span className="text-xs text-muted-foreground">
            ยังไม่มีรุ่นที่รองรับ
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          disabled={submitting}
          placeholder="เพิ่มรุ่นอุปกรณ์ เช่น GT06L"
          className="h-8"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addModel();
            }
          }}
        />
        <Button size="sm" variant="outline" disabled={submitting} onClick={addModel}>
          เพิ่ม
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" disabled={submitting} onClick={() => void save()}>
          {submitting ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={submitting}
          onClick={() => setEditing(false)}
        >
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}
