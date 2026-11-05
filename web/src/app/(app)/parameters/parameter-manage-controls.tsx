"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Notice } from "@/components/ui/notice";
import { useDeviceModels } from "@/hooks/use-device-models";
import { ApiError } from "@/lib/api";
import {
  deleteConfigDefinition,
  getConfigDefinitionUsage,
  updateConfigDefinition,
  type ConfigDefinitionUsage,
  type ConfigFieldDefinition,
  type ConfigFieldModelSupport,
  type UpdateConfigDefinitionInput,
} from "@/lib/config-definition-api";
import { ModelPicker, expandModelsToSupport } from "./model-picker";

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
  const [appliesToAllModels, setAppliesToAllModels] = useState(
    d.appliesToAllModels,
  );
  const [selectedModelNames, setSelectedModelNames] = useState<Set<string>>(
    () => new Set(d.supportedModels.map((m) => m.deviceModel)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ทะเบียนรุ่นใช้เลือกโมเดลที่รองรับ — โหลดไม่ได้ก็ยังแก้ฟิลด์อื่นได้ แค่ไม่แตะส่วนโมเดล
  const deviceModels = useDeviceModels();
  const registry = useMemo(
    () =>
      [...(deviceModels.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [deviceModels.data],
  );
  const modelsReady = deviceModels.data !== null;
  // คู่ที่ผูกไว้กับรุ่นที่ไม่อยู่ในทะเบียน (ข้อมูลเก่า) เลือก/ถอดในหน้านี้ไม่ได้ —
  // คงไว้ตามเดิมตอนบันทึก ไม่ให้หายเงียบๆ
  const legacyPairs: ConfigFieldModelSupport[] = useMemo(() => {
    const registered = new Set(registry.map((m) => m.name));
    return d.supportedModels.filter((m) => !registered.has(m.deviceModel));
  }, [registry, d.supportedModels]);

  const numeric = NUMERIC_TYPES.includes(d.dataType);

  async function submit() {
    if (!session?.accessToken) return;
    setError(null);

    // ส่งฟิลด์โมเดลเฉพาะที่เปลี่ยนจริง (PATCH แทนที่ทั้งชุด) · เปิด "ทุกโมเดล" ไม่แตะแถวเดิม
    const modelFields: Pick<
      UpdateConfigDefinitionInput,
      "supportedModels" | "appliesToAllModels"
    > = {};
    if (modelsReady) {
      if (appliesToAllModels !== d.appliesToAllModels) {
        modelFields.appliesToAllModels = appliesToAllModels;
      }
      if (!appliesToAllModels) {
        // เทียบที่ระดับ "ชื่อรุ่น" (เฉพาะรุ่นที่อยู่ในทะเบียน) ไม่ใช่ระดับคู่รุ่น/โปรโตคอล —
        // คู่ที่บันทึกไว้อาจไม่ตรงกับโปรโตคอลในทะเบียนปัจจุบัน (ทะเบียนเพิ่ม/ลดโปรโตคอลภายหลัง)
        // ถ้าเทียบระดับคู่ แค่แก้คำอธิบายก็จะส่ง supportedModels ชุดใหม่ ขยาย/ตัดขอบเขตเอง (รีวิว B #439)
        const registered = new Set(registry.map((m) => m.name));
        const registeredNames = (names: Iterable<string>) =>
          [...names].filter((n) => registered.has(n)).sort().join(",");
        const originalNames = new Set(d.supportedModels.map((m) => m.deviceModel));
        const selectionChanged =
          registeredNames(selectedModelNames) !== registeredNames(originalNames);
        // รุ่นที่มีอยู่เดิมคงคู่เดิมไว้ · ขยายโปรโตคอลจากทะเบียนเฉพาะรุ่นที่เพิ่มใหม่
        const next = [
          ...registry
            .filter((m) => selectedModelNames.has(m.name))
            .flatMap((m) =>
              originalNames.has(m.name)
                ? d.supportedModels.filter((p) => p.deviceModel === m.name)
                : expandModelsToSupport([m], new Set([m.name])),
            ),
          ...legacyPairs,
        ];
        if (next.length === 0) {
          setError('เลือกโมเดลที่รองรับอย่างน้อย 1 โมเดล หรือเปิด "ใช้ได้กับทุกโมเดล"');
          return;
        }
        if (selectionChanged) modelFields.supportedModels = next;
      }
    }

    setSubmitting(true);
    const input: UpdateConfigDefinitionInput = {
      ...modelFields,
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
          <div className="flex flex-col gap-2">
            <Label>โมเดลที่รองรับ</Label>
            {!modelsReady ? (
              <p className="text-xs text-muted-foreground">
                {deviceModels.error
                  ? "โหลดทะเบียนโมเดลไม่ได้ แก้ส่วนโมเดลตอนนี้ไม่ได้ (ฟิลด์อื่นยังแก้ได้)"
                  : "กำลังโหลดทะเบียนโมเดล…"}
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={appliesToAllModels}
                    onChange={(e) => setAppliesToAllModels(e.target.checked)}
                  />
                  ใช้ได้กับทุกโมเดล
                </label>
                {/* เตือนเมื่อสถานะ "ทุกโมเดล + บังคับ" ใหม่นี้ต่างจากที่บันทึกไว้ ไม่ว่าจะ
                    เพิ่งติ๊กตัวไหน (รีวิว B #439 ข้อ 2) */}
                {appliesToAllModels && required && !(d.appliesToAllModels && d.required) && (
                  <Notice tone="warning">
                    ตั้งเป็นบังคับกรอกและใช้ได้ทุกโมเดล Config ทุกรุ่นต้องมีค่านี้ทันที
                    Config เดิมที่ยังไม่มีจะบันทึกการแก้ไขไม่ผ่านจนกว่าจะใส่ค่านี้
                  </Notice>
                )}
                {!appliesToAllModels && (
                  <>
                    <ModelPicker
                      models={registry}
                      selected={selectedModelNames}
                      onToggle={(name) =>
                        setSelectedModelNames((prev) => {
                          const next = new Set(prev);
                          if (next.has(name)) next.delete(name);
                          else next.add(name);
                          return next;
                        })
                      }
                      onSetMany={(names, on) =>
                        setSelectedModelNames((prev) => {
                          const next = new Set(prev);
                          for (const n of names) {
                            if (on) next.add(n);
                            else next.delete(n);
                          }
                          return next;
                        })
                      }
                    />
                    {legacyPairs.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        รุ่นนอกทะเบียน (คงไว้ตามเดิม แก้ในหน้านี้ไม่ได้):{" "}
                        {legacyPairs
                          .map((m) => `${m.deviceModel}/${m.protocol}`)
                          .join(", ")}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
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
