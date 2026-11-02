"use client";

import { useEffect, useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import {
  deleteConfigDefinition,
  getConfigDefinitionUsage,
  updateConfigDefinition,
  type ConfigDefinitionUsage,
  type ConfigFieldDefinition,
  type UpdateConfigDefinitionInput,
} from "@/lib/config-definition-api";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

const NUMERIC_TYPES = ["integer", "decimal", "number"];

/** ข้อความเตือนว่ามี Config ใช้ field นี้กี่ตัว (แก้กฎ validate มีผลกับ Config ที่สร้าง/แก้ครั้งถัดไป) */
function UsageNote({
  usage,
  mode,
}: {
  usage: ConfigDefinitionUsage | null;
  mode: "edit" | "delete";
}) {
  if (!usage || usage.count === 0) return null;
  const names = usage.configs.map((c) => c.name).join(", ");
  const more = usage.count > usage.configs.length ? " และอื่นๆ" : "";
  return (
    <p className="rounded-md border border-warning/40 bg-warning-subtle p-2 text-sm text-warning-foreground">
      {mode === "edit"
        ? `มี Config ใช้พารามิเตอร์นี้อยู่ ${usage.count} ตัว (${names}${more}) การแก้กฎตรวจสอบมีผลกับ Config ที่สร้างหรือแก้ครั้งถัดไป ไม่แก้ Config เดิมย้อนหลัง`
        : `ลบไม่ได้ เพราะมี Config ใช้อยู่ ${usage.count} ตัว (${names}${more}) ลบหรือแก้ Config เหล่านั้นก่อน`}
    </p>
  );
}

/** ปุ่ม แก้ไข / ลบ พารามิเตอร์ใน drawer รายละเอียด (ConfigEngineer, SuperAdmin) */
export function ParameterManageControls({
  definition,
  onChanged,
  onDeleted,
}: {
  definition: ConfigFieldDefinition;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { session } = useAuth();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [usage, setUsage] = useState<ConfigDefinitionUsage | null>(null);

  // โหลดจำนวน Config ที่ใช้ field นี้ตอนเปิด dialog (ใช้เตือนตอนแก้ และบล็อกตอนลบ)
  useEffect(() => {
    if ((!editing && !deleting) || !session?.accessToken) return;
    let cancelled = false;
    getConfigDefinitionUsage(session.accessToken, definition.id)
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, deleting, session?.accessToken, definition.id]);

  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(): Promise<boolean> {
    if (!session?.accessToken) return false;
    setDeleteError(null);
    try {
      await deleteConfigDefinition(session.accessToken, definition.id);
      toast.success(`ลบพารามิเตอร์ ${definition.fieldName} แล้ว`);
      onDeleted();
      return true;
    } catch (err) {
      const message = errorMessage(err, "ลบพารามิเตอร์ไม่สำเร็จ");
      setDeleteError(message);
      toast.error(message);
      return false;
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <PencilIcon /> แก้ไข
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setDeleteError(null);
            setDeleting(true);
          }}
        >
          <Trash2Icon /> ลบ
        </Button>
      </div>

      {editing && (
        <EditParameterDialog
          definition={definition}
          usage={usage}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`ลบพารามิเตอร์ ${definition.fieldName}?`}
        description={
          <>
            ลบออกจากคลังถาวร กู้คืนไม่ได้ (สร้างใหม่ได้ด้วยชื่อเดิม)
            <span className="mt-2 block">
              <UsageNote usage={usage} mode="delete" />
            </span>
            {deleteError && (
              <span className="mt-2 block text-destructive">{deleteError}</span>
            )}
          </>
        }
        confirmLabel="ยืนยันลบ"
        destructive
        confirmDisabled={usage !== null && usage.count > 0}
        onConfirm={handleDelete}
      />
    </>
  );
}

function EditParameterDialog({
  definition: d,
  usage,
  onClose,
  onSaved,
}: {
  definition: ConfigFieldDefinition;
  usage: ConfigDefinitionUsage | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const [description, setDescription] = useState(d.description ?? "");
  const [unit, setUnit] = useState(d.unit ?? "");
  const [category, setCategory] = useState(d.category ?? "");
  const [defaultValue, setDefaultValue] = useState(d.defaultValue ?? "");
  const [minValue, setMinValue] = useState(d.minValue?.toString() ?? "");
  const [maxValue, setMaxValue] = useState(d.maxValue?.toString() ?? "");
  const [allowedText, setAllowedText] = useState(d.allowedValues.join(", "));
  const [required, setRequired] = useState(d.required);
  const [sensitive, setSensitive] = useState(d.sensitive);
  const [restartRequired, setRestartRequired] = useState(d.restartRequired);
  const [stOverridable, setStOverridable] = useState(d.stOverridable);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numeric = NUMERIC_TYPES.includes(d.dataType);

  async function submit() {
    if (!session?.accessToken) return;
    setSubmitting(true);
    setError(null);
    const input: UpdateConfigDefinitionInput = {
      description: description.trim() === "" ? null : description.trim(),
      unit: unit.trim() === "" ? null : unit.trim(),
      category: category.trim() === "" ? null : category.trim(),
      defaultValue: defaultValue === "" ? null : defaultValue,
      allowedValues: allowedText
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== ""),
      required,
      sensitive,
      restartRequired,
      stOverridable,
      ...(numeric
        ? {
            minValue: minValue.trim() === "" ? null : Number(minValue),
            maxValue: maxValue.trim() === "" ? null : Number(maxValue),
          }
        : {}),
    };
    try {
      await updateConfigDefinition(session.accessToken, d.id, input);
      toast.success(`บันทึกการแก้ไข ${d.fieldName} แล้ว`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setSubmitting(false);
    }
  }

  const checks: [string, boolean, (v: boolean) => void][] = [
    ["บังคับกรอก", required, setRequired],
    ["ค่าอ่อนไหว", sensitive, setSensitive],
    ["ต้อง Restart กล่อง", restartRequired, setRestartRequired],
    ["ST override ได้", stOverridable, setStOverridable],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>แก้ไขพารามิเตอร์ {d.fieldName}</DialogTitle>
          <DialogDescription>
            เปลี่ยนชื่อไม่ได้ (Config เก็บค่าตามชื่อ) ถ้าต้องการชื่อใหม่ให้ลบแล้วสร้างใหม่
          </DialogDescription>
        </DialogHeader>
        <UsageNote usage={usage} mode="edit" />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pe-description">คำอธิบาย</Label>
            <Input
              id="pe-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pe-unit">หน่วย</Label>
              <Input
                id="pe-unit"
                value={unit}
                maxLength={20}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pe-category">หมวด</Label>
              <Input
                id="pe-category"
                value={category}
                maxLength={50}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pe-default">ค่าเริ่มต้น</Label>
            <Input
              id="pe-default"
              value={defaultValue}
              maxLength={255}
              disabled={sensitive}
              onChange={(e) => setDefaultValue(e.target.value)}
            />
            {sensitive && (
              <p className="text-xs text-muted-foreground">
                ค่าอ่อนไหวตั้งค่าเริ่มต้นไม่ได้ ล้างค่าเริ่มต้นก่อนถ้าจะเปิดตัวเลือกนี้
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pe-allowed">ค่าที่ยอมรับ (คั่นด้วยเครื่องหมายจุลภาค ว่าง = ไม่จำกัด)</Label>
            <Input
              id="pe-allowed"
              value={allowedText}
              onChange={(e) => setAllowedText(e.target.value)}
            />
          </div>
          {numeric && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pe-min">ค่าต่ำสุด</Label>
                <Input
                  id="pe-min"
                  inputMode="decimal"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pe-max">ค่าสูงสุด</Label>
                <Input
                  id="pe-max"
                  inputMode="decimal"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {checks.map(([label, value, set]) => (
              <label key={label} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? "กำลังบันทึก…" : "บันทึก"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
