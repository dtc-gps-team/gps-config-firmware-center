"use client";

import { useMemo, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  createConfigDefinition,
  type ConfigFieldModelSupport,
} from "@/lib/config-definition-api";
import type { DeviceModel } from "@/lib/device-model-api";

/** ชนิดข้อมูลที่ backend `matchesDataType` รู้จัก (ค่าอื่นปล่อยผ่านเหมือนไม่มีนิยาม
 * — ดู config-definition.service.ts) จำกัดไว้ 3 ค่านี้เพื่อไม่ให้พิมพ์ผิด */
const DATA_TYPES = ["string", "number", "boolean"] as const;

type Props = {
  /** ทะเบียนรุ่นอุปกรณ์ทั้งหมด (`GET /device-models`, issue #209) — เลือกเป็น
   * checkbox แค่ระดับรุ่น ไม่ต้องเลือก protocol เอง (issue #203) */
  deviceModels: DeviceModel[];
  /** ชื่อ field ที่มีอยู่แล้ว (lowercase) — กันซ้ำตั้งแต่ฝั่ง client */
  existingNames: Set<string>;
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * ฟอร์มสร้าง Parameter (Config Field Definition) ใหม่ — `POST /config-definitions`
 * · ConfigEngineer เท่านั้น (gate ที่ปุ่มเปิดฟอร์มใน parameter-library-view.tsx +
 * PermissionGuard ฝั่ง backend) ตาม wireframe frame "คลัง Parameter"
 *
 * `supportedModels` (คู่ deviceModel/protocol ที่ backend ต้องการ) **ไม่ได้ให้
 * ผู้ใช้เลือก protocol เองแล้ว** (issue #203) — ผู้ใช้เลือกแค่ "รุ่นอุปกรณ์" จาก
 * ทะเบียน `DeviceModel` แล้วระบบสร้างคู่ให้ครบทุก protocol ที่รุ่นนั้นรองรับเอง
 * ตาม `DeviceModel.supportedProtocols` (approach ที่ตกลงกันไว้ใน issue #203 —
 * ไม่เดาว่า 1 รุ่น = 1 protocol เสมอ)
 */
export function ParameterCreateForm({
  deviceModels,
  existingNames,
  onCreated,
  onCancel,
}: Props) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;

  const [fieldName, setFieldName] = useState("");
  const [description, setDescription] = useState("");
  const [dataType, setDataType] = useState<string>("string");
  const [required, setRequired] = useState(false);
  const [unknownSpec, setUnknownSpec] = useState(false);
  const [stOverridable, setStOverridable] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [unit, setUnit] = useState("");
  const [defaultValue, setDefaultValue] = useState("");
  const [allowedValues, setAllowedValues] = useState<string[]>([]);
  const [optionDraft, setOptionDraft] = useState("");
  const [selectedModelNames, setSelectedModelNames] = useState<Set<string>>(
    new Set(),
  );

  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorList, setFormErrorList] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const sortedModels = useMemo(
    () => [...deviceModels].sort((a, b) => a.name.localeCompare(b.name)),
    [deviceModels],
  );

  function clearErrors() {
    setNameError(null);
    setFormError(null);
    setFormErrorList([]);
  }

  function toggleModel(name: string) {
    clearErrors();
    setSelectedModelNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addOption() {
    const v = optionDraft.trim();
    if (!v || allowedValues.includes(v)) {
      setOptionDraft("");
      return;
    }
    setAllowedValues((prev) => [...prev, v]);
    setOptionDraft("");
  }

  function removeOption(v: string) {
    setAllowedValues((prev) => prev.filter((x) => x !== v));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || submitting) return;
    clearErrors();

    const trimmedName = fieldName.trim();
    if (!trimmedName) {
      setNameError("กรอกชื่อ field");
      return;
    }
    if (existingNames.has(trimmedName.toLowerCase())) {
      setNameError(`มี field ชื่อ "${trimmedName}" อยู่แล้วในคลัง`);
      return;
    }
    if (selectedModelNames.size === 0) {
      setFormError("เลือกรุ่นอุปกรณ์ที่รองรับอย่างน้อย 1 รุ่น");
      return;
    }
    if (unit.trim().length > 20) {
      setFormError("หน่วยยาวเกิน 20 ตัวอักษร");
      return;
    }
    if (defaultValue.trim().length > 255) {
      setFormError("ค่าเริ่มต้นยาวเกิน 255 ตัวอักษร");
      return;
    }

    /** ขยายแต่ละรุ่นที่เลือกเป็นคู่ (deviceModel, protocol) ให้ครบทุก protocol
     * ที่รุ่นนั้นรองรับ (issue #203 approach ข) — ไม่ใช่ให้ผู้ใช้เลือก protocol เอง */
    const supportedModels: ConfigFieldModelSupport[] = sortedModels
      .filter((m) => selectedModelNames.has(m.name))
      .flatMap((m) =>
        m.supportedProtocols.map((protocol) => ({
          deviceModel: m.name,
          protocol,
        })),
      );
    const trimmedDesc = description.trim();
    const trimmedUnit = unit.trim();
    const trimmedDefault = defaultValue.trim();

    setSubmitting(true);
    try {
      await createConfigDefinition(token, {
        fieldName: trimmedName,
        dataType,
        required,
        ...(unknownSpec ? { unknownSpec: true } : {}),
        ...(stOverridable ? { stOverridable: true } : {}),
        ...(sensitive ? { sensitive: true } : {}),
        ...(allowedValues.length ? { allowedValues } : {}),
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
        ...(trimmedUnit ? { unit: trimmedUnit } : {}),
        // sensitive + defaultValue ห้ามมาคู่กัน (backend ปฏิเสธ 400 — กันค่าอ่อนไหว
        // รั่วผ่าน GET /config-definitions ที่เปิดกว้างหลาย role) ไม่ส่ง defaultValue
        // เลยถ้า sensitive ไว้ตั้งแต่ต้น แทนที่จะปล่อยให้ backend ปฏิเสธ
        ...(!sensitive && trimmedDefault ? { defaultValue: trimmedDefault } : {}),
        supportedModels,
      });
      toast.success(`สร้าง Parameter "${trimmedName}" แล้ว`);
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setNameError(err.message);
        toast.error(err.message);
      } else if (err instanceof ApiError) {
        setFormError(err.message);
        setFormErrorList(err.details ?? []);
        toast.error(err.message);
      } else {
        setFormError("สร้าง Parameter ไม่สำเร็จ");
        toast.error("สร้าง Parameter ไม่สำเร็จ");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">เพิ่ม Parameter ใหม่</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="param-name">ชื่อ field</Label>
              <Input
                id="param-name"
                value={fieldName}
                onChange={(e) => {
                  setFieldName(e.target.value);
                  clearErrors();
                }}
                placeholder="เช่น max_speed_alert"
                autoComplete="off"
                aria-invalid={nameError ? true : undefined}
              />
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="param-datatype">ชนิดข้อมูล</Label>
              <Select
                value={dataType}
                onValueChange={(value) => value && setDataType(value)}
              >
                <SelectTrigger id="param-datatype" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="param-desc">คำอธิบาย (ไม่บังคับ)</Label>
            <Input
              id="param-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="อธิบายสั้นๆ ว่า field นี้ควบคุมอะไร"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="param-unit">หน่วย (ไม่บังคับ)</Label>
            <Input
              id="param-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder='เช่น "วินาที", "%", "เมตร"'
              maxLength={20}
              autoComplete="off"
              className="sm:max-w-56"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="param-default-value">
              ค่าเริ่มต้น (Default Value, ไม่บังคับ)
            </Label>
            {sensitive ? (
              <p className="text-xs text-muted-foreground">
                field ที่เป็น Sensitive ตั้งค่าเริ่มต้นไม่ได้ — ป้องกันค่าอ่อนไหวรั่วผ่าน
                คลัง Parameter ที่หลาย Role เข้าถึงได้
              </p>
            ) : dataType === "boolean" ? (
              <Select
                value={defaultValue}
                onValueChange={(value) => setDefaultValue(value ?? "")}
              >
                <SelectTrigger
                  id="param-default-value"
                  className="w-full sm:max-w-56"
                >
                  <SelectValue placeholder="— ไม่ตั้งค่าเริ่มต้น —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="param-default-value"
                type={dataType === "number" ? "number" : "text"}
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="เช่น ค่าที่ใช้บ่อยที่สุด"
                maxLength={255}
                autoComplete="off"
                className="sm:max-w-56"
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="param-option-draft">
              ค่าที่ยอมรับ (ไม่บังคับ · ว่าง = ไม่จำกัดค่า)
            </Label>
            {allowedValues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {allowedValues.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-muted px-2 py-0.5 font-mono text-xs"
                  >
                    {v}
                    <button
                      type="button"
                      onClick={() => removeOption(v)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`ลบตัวเลือก ${v}`}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                id="param-option-draft"
                value={optionDraft}
                onChange={(e) => setOptionDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOption();
                  }
                }}
                placeholder="พิมพ์ตัวเลือกแล้วกด Enter"
                autoComplete="off"
                className="sm:max-w-64"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOption}
              >
                <PlusIcon className="size-3.5" /> เพิ่ม
              </Button>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">รุ่นอุปกรณ์ที่รองรับ</legend>
            {sortedModels.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                ยังไม่มีรุ่นอุปกรณ์ในระบบ (`DeviceModel`) — เพิ่มรุ่นอุปกรณ์ก่อน
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {sortedModels.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 text-sm"
                    htmlFor={`param-model-${m.id}`}
                  >
                    <Checkbox
                      id={`param-model-${m.id}`}
                      checked={selectedModelNames.has(m.name)}
                      onCheckedChange={() => toggleModel(m.name)}
                    />
                    <span className="font-mono">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({m.supportedProtocols.join(", ")})
                    </span>
                    {m.status === "discontinued" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">
                        เลิกผลิต
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor="param-required"
            >
              <Checkbox
                id="param-required"
                checked={required}
                onCheckedChange={(c) => setRequired(c === true)}
              />
              บังคับกรอก (required)
            </label>
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor="param-unknown-spec"
            >
              <Checkbox
                id="param-unknown-spec"
                checked={unknownSpec}
                onCheckedChange={(c) => setUnknownSpec(c === true)}
              />
              ยังไม่มี spec ครบ (รู้แค่ชื่อ + ชนิดข้อมูล)
            </label>
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor="param-st-overridable"
            >
              <Checkbox
                id="param-st-overridable"
                checked={stOverridable}
                onCheckedChange={(c) => setStOverridable(c === true)}
              />
              ST override ได้ (แก้ค่าบนอุปกรณ์หน้างานได้ — OT ไม่มีสิทธิ์นี้)
            </label>
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor="param-sensitive"
            >
              <Checkbox
                id="param-sensitive"
                checked={sensitive}
                onCheckedChange={(c) => setSensitive(c === true)}
              />
              ค่าอ่อนไหว (Sensitive — เช่นรหัสผ่าน ซ่อนค่าบนหน้าจอ)
            </label>
          </div>

          {formError && (
            <div className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span>{formError}</span>
              {formErrorList.length > 0 && (
                <ul className="list-disc pl-5 text-xs">
                  {formErrorList.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "กำลังบันทึก…" : "บันทึก Parameter"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
