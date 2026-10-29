"use client";

import { useMemo, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
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

/** ชนิดข้อมูลที่ backend `matchesDataType` รู้จัก — มติ issue #201 (อัปเดต
 * 2026-09-22) ต้องตรงกับ `CONFIG_DATA_TYPES` ใน
 * `backend/src/config-definition/config-data-types.ts` เสมอ (ไม่มี shared
 * package ข้าม backend/web ตามกฎ monorepo ใน CLAUDE.md — แก้ชุดนี้ต้องแก้คู่กัน
 * ทั้ง 2 ฝั่ง) */
const DATA_TYPES = [
  "integer",
  "decimal",
  "string",
  "text",
  "boolean",
  "date",
  "datetime",
  "json",
  "array",
  "uuid",
] as const;

const DATA_TYPE_LABELS: Record<(typeof DATA_TYPES)[number], string> = {
  integer: "integer: จำนวนเต็ม",
  decimal: "decimal: จำนวนทศนิยม",
  string: "string: ข้อความสั้น",
  text: "text: ข้อความยาว",
  boolean: "boolean: จริง/เท็จ",
  date: "date: วันที่ (YYYY-MM-DD)",
  datetime: "datetime: วันที่เวลา (ISO 8601)",
  json: "json: ออบเจกต์ JSON",
  array: "array: รายการค่า (JSON array)",
  uuid: "uuid: รหัส UUID",
};

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
 * ตอนนั้นไม่เดาว่า 1 รุ่น = 1 protocol · ต่อมามติรีวิวพี่เลี้ยง 19 ต.ค. 2569
 * กำหนดว่า 1 โมเดลมีได้โปรโตคอลเดียว จึงได้คู่เดียวต่อรุ่นเป็นปกติ แต่ยังวนตาม
 * array เผื่อรุ่นเก่าที่มีหลายค่าอยู่)
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
      setFormError("เลือกโมเดลที่รองรับอย่างน้อย 1 โมเดล");
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

  const numeric = dataType === "integer" || dataType === "decimal";
  const previewName = fieldName.trim() || "field_name";
  const selectedCount = selectedModelNames.size;

  return (
    <form
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
      onSubmit={handleSubmit}
    >
      <div className="flex min-w-0 flex-col gap-6">
        <Card className="gap-5 p-6">
          <SectionHeading title="ข้อมูลหลัก" hint="ชื่อ ชนิดข้อมูล และคำอธิบายที่ผู้สร้าง Config จะเห็น" />
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
                className="font-instrument"
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
                  <SelectValue>
                    {(value: (typeof DATA_TYPES)[number]) =>
                      DATA_TYPE_LABELS[value]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {DATA_TYPE_LABELS[t]}
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
        </Card>

        <Card className="gap-5 p-6">
          <SectionHeading title="ค่า" hint="ค่าเริ่มต้นที่เติมให้ตอนสร้าง Config ใหม่ และชุดค่าที่ยอมรับ" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="param-default-value">
              ค่าเริ่มต้น (Default Value, ไม่บังคับ)
            </Label>
            {sensitive ? (
              <p className="text-xs text-muted-foreground">
                field ที่เป็น Sensitive ตั้งค่าเริ่มต้นไม่ได้ ป้องกันค่าอ่อนไหวรั่วผ่าน
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
                  <SelectValue placeholder="- ไม่ตั้งค่าเริ่มต้น -" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="param-default-value"
                // แก้ตามรีวิว B บน PR #255 ข้อ 3 รอบ 2 — เดิมเช็ค
                // dataType === "number" ซึ่งเป็น dead code มาตั้งแต่ก่อน
                // งานขยายชุด dataType (ชุดตัวเลือกใน DATA_TYPES ด้านบน
                // ไม่มี "number" อีกแล้ว ค่า state จึงเป็นค่านี้ไม่ได้)
                // เปลี่ยนให้ตรงกับชุดตัวเลขจริงปัจจุบันแทน
                type={numeric ? "number" : "text"}
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="เช่น ค่าที่ใช้บ่อยที่สุด"
                maxLength={255}
                autoComplete="off"
                className="font-instrument sm:max-w-56"
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="param-option-draft">
              ค่าที่ยอมรับ (ไม่บังคับ ถ้าว่างคือไม่จำกัดค่า)
            </Label>
            {allowedValues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {allowedValues.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-surface-sunken px-2 py-0.5 font-instrument text-xs"
                  >
                    {v}
                    <button
                      type="button"
                      onClick={() => removeOption(v)}
                      className="rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
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
        </Card>

        <Card className="gap-4 p-6">
          <SectionHeading
            title="โมเดลที่รองรับ"
            hint={
              selectedCount > 0
                ? `เลือกแล้ว ${selectedCount} จาก ${sortedModels.length} โมเดล`
                : "เลือกอย่างน้อย 1 โมเดล"
            }
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">โมเดลที่รองรับ</legend>
            {sortedModels.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                ยังไม่มีโมเดลในระบบ เพิ่มโมเดลก่อน
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {sortedModels.map((m) => (
                  <label
                    key={m.id}
                    htmlFor={`param-model-${m.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted/60 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
                  >
                    <Checkbox
                      id={`param-model-${m.id}`}
                      checked={selectedModelNames.has(m.name)}
                      onCheckedChange={() => toggleModel(m.name)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-instrument">{m.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({m.supportedProtocols.join(", ")})
                      </span>
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
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24">
        <Card className="gap-3 p-5">
          <SectionHeading title="ตัวเลือก" hint="กำหนดพฤติกรรมของ field นี้" />
          <FlagRow
            id="param-required"
            checked={required}
            onChange={setRequired}
            label="บังคับกรอก (required)"
            hint="ผู้สร้าง Config ต้องใส่ค่านี้ทุกครั้ง"
          />
          <FlagRow
            id="param-unknown-spec"
            checked={unknownSpec}
            onChange={setUnknownSpec}
            label="ยังไม่มี spec ครบ (รู้แค่ชื่อ + ชนิดข้อมูล)"
            hint="ติดป้ายไว้ให้รู้ว่ายังไม่ยืนยันรายละเอียด"
          />
          <FlagRow
            id="param-st-overridable"
            checked={stOverridable}
            onChange={setStOverridable}
            label="ST override ได้ (แก้ค่าบนอุปกรณ์หน้างานได้, OT ไม่มีสิทธิ์นี้)"
          />
          <FlagRow
            id="param-sensitive"
            checked={sensitive}
            onChange={setSensitive}
            label="ค่าอ่อนไหว (Sensitive: เช่นรหัสผ่าน ซ่อนค่าบนหน้าจอ)"
          />
        </Card>

        <Card className="gap-3 p-5" aria-hidden>
          <SectionHeading title="พรีวิวในหน้าสร้าง Config" hint="ช่องกรอกจะหน้าตาประมาณนี้" />
          <div className="flex flex-col gap-1.5 rounded-lg border p-3">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-instrument text-xs">
                {previewName}
                {required && <span className="text-destructive"> *</span>}
              </span>
              {sensitive && (
                <span className="rounded-full bg-secondary px-1.5 text-[0.65rem] text-secondary-foreground">
                  อ่อนไหว
                </span>
              )}
            </span>
            {description.trim() && (
              <span className="text-xs text-muted-foreground">
                {description.trim()}
              </span>
            )}
            {dataType === "boolean" ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block size-4 rounded-[4px] border border-muted-foreground/60" />
                เปิดใช้งาน
              </span>
            ) : allowedValues.length > 0 ? (
              <span className="flex h-8 items-center justify-between rounded-lg border border-input px-2.5 text-sm text-muted-foreground">
                {defaultValue && allowedValues.includes(defaultValue)
                  ? defaultValue
                  : "- เลือก -"}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="flex h-8 flex-1 items-center rounded-lg border border-input px-2.5 font-instrument text-sm text-muted-foreground">
                  {sensitive ? "••••••" : defaultValue || " "}
                </span>
                {unit.trim() && (
                  <span className="text-xs text-muted-foreground">
                    {unit.trim()}
                  </span>
                )}
              </span>
            )}
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4 lg:col-span-2">
        {formError && (
          <div role="alert" className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
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

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            ยกเลิก
          </Button>
          <Button type="submit" loading={submitting}>
            {submitting ? "กำลังบันทึก…" : "บันทึก Parameter"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function FlagRow({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-muted/60 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
    >
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
