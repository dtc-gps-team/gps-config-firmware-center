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
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  integer: "integer (จำนวนเต็ม)",
  decimal: "decimal (ทศนิยม)",
  string: "string (ข้อความ)",
  text: "text (ข้อความหลายบรรทัด)",
  boolean: "boolean (จริง/เท็จ)",
  date: "date (วันที่)",
  datetime: "datetime (วันที่และเวลา)",
  json: "json (ชุดค่าแบบ key-value)",
  array: "array (รายการหลายค่า)",
  uuid: "uuid (รหัส UUID)",
};

/** ตัวอย่างค่าใต้ช่องเลือกชนิด — รูปแบบตรงกับที่ฟอร์ม Config และ backend ตรวจ */
const DATA_TYPE_HINTS: Record<(typeof DATA_TYPES)[number], string> = {
  integer: "เช่น 8080",
  decimal: "เช่น 0.5",
  string: "ข้อความบรรทัดเดียว เช่น internet",
  text: "ข้อความที่ยาวหรือมีหลายบรรทัด",
  boolean: "ค่า true หรือ false",
  date: "รูปแบบ YYYY-MM-DD เช่น 2026-10-29",
  datetime: "รูปแบบ ISO 8601 เช่น 2026-10-29T08:00:00Z",
  json: 'JSON object เช่น {"key": "value"}',
  array: "JSON array เช่น [1, 2, 3]",
  uuid: "รหัส UUID",
};

type Props = {
  /** ทะเบียนรุ่นอุปกรณ์ทั้งหมด (`GET /device-models`, issue #209) — เลือกเป็น
   * checkbox แค่ระดับรุ่น ไม่ต้องเลือก protocol เอง (issue #203) */
  deviceModels: DeviceModel[];
  /** ชื่อ field ที่มีอยู่แล้ว (lowercase) — กันซ้ำตั้งแต่ฝั่ง client */
  existingNames: Set<string>;
  /** เรียกหลังสร้างสำเร็จ พร้อมชื่อ field ที่เพิ่งสร้าง */
  onCreated: (fieldName: string) => void | Promise<void>;
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
  // ค่าที่ยอมรับ: พิมพ์หนึ่งค่าต่อบรรทัด (ตัดช่องว่าง ตัดบรรทัดว่าง ตัดค่าซ้ำ)
  const [allowedText, setAllowedText] = useState("");
  const allowedValues = useMemo(
    () => [
      ...new Set(
        allowedText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ],
    [allowedText],
  );
  const [selectedModelNames, setSelectedModelNames] = useState<Set<string>>(
    new Set(),
  );

  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorList, setFormErrorList] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  // กรอกค้างไว้แล้วออกจากหน้า (รีเฟรช/ปิดแท็บ/กดยกเลิก) ต้องเตือนก่อน
  const isDirty =
    [fieldName, description, unit, defaultValue, allowedText].some((v) => v.trim() !== "") ||
    dataType !== "string" ||
    required ||
    unknownSpec ||
    stOverridable ||
    sensitive ||
    selectedModelNames.size > 0;
  const { confirmLeave } = useUnsavedChangesWarning(isDirty && !saved);

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
      setSaved(true);
      toast.success(`สร้าง Parameter "${trimmedName}" แล้ว`);
      await onCreated(trimmedName);
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

  const missing = [
    ...(fieldName.trim() ? [] : ["ชื่อ field"]),
    ...(selectedModelNames.size > 0 ? [] : ["โมเดลที่รองรับ"]),
  ];

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Card className="w-full gap-0 overflow-hidden p-0">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">ข้อมูล Parameter</h2>
          <p className="text-sm text-muted-foreground">
            กรอกชื่อ ชนิดข้อมูล และเลือกโมเดล ส่วนที่เหลือไม่บังคับ
          </p>
        </div>

        <div>
          <div className="flex min-w-0 flex-col divide-y">
            <section className="flex flex-col gap-4 p-6">
              <SectionLabel>ข้อมูลหลัก</SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <p className="text-xs text-muted-foreground">
                    {DATA_TYPE_HINTS[dataType as (typeof DATA_TYPES)[number]]}
                  </p>
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
                  />
                </div>

                <div className="flex flex-col gap-1.5 sm:col-span-2">
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
                  <Label htmlFor="param-default-value">
                    ค่าเริ่มต้น (ไม่บังคับ)
                  </Label>
                  {sensitive ? (
                    <p className="rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
                      field ที่ซ่อนค่าตั้งค่าเริ่มต้นไม่ได้ กันค่าอ่อนไหวรั่วผ่านคลัง
                      Parameter
                    </p>
                  ) : dataType === "boolean" ? (
                    <Select
                      value={defaultValue}
                      onValueChange={(value) => setDefaultValue(value ?? "")}
                    >
                      <SelectTrigger id="param-default-value" className="w-full">
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
                      placeholder="ค่าที่ใช้บ่อยที่สุด"
                      maxLength={255}
                      autoComplete="off"
                      className="font-instrument"
                    />
                  )}
                </div>
              </div>
            </section>

            <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <section className="flex flex-col gap-3 p-6">
              <SectionLabel>
                โมเดลที่รองรับ{" "}
                <span className="tabular-nums">
                  ({selectedModelNames.size}/{sortedModels.length})
                </span>
              </SectionLabel>
              <ModelPicker
                models={sortedModels}
                selected={selectedModelNames}
                onToggle={toggleModel}
                onSetMany={(names, on) => {
                  clearErrors();
                  setSelectedModelNames((prev) => {
                    const next = new Set(prev);
                    for (const n of names) {
                      if (on) next.add(n);
                      else next.delete(n);
                    }
                    return next;
                  });
                }}
              />
            </section>

            <section className="flex flex-col gap-3 p-6">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="param-allowed">
                  ค่าที่เลือกได้ (ไม่บังคับ){" "}
                  {allowedValues.length > 0 && (
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {allowedValues.length} ค่า
                    </span>
                  )}
                </Label>
                <textarea
                  id="param-allowed"
                  value={allowedText}
                  onChange={(e) => setAllowedText(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder={"พิมพ์ 1 ค่าต่อ 1 บรรทัด เช่น\nauto\n2g\n4g"}
                  className="min-h-20 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 font-instrument text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                />
                <p className="text-xs text-muted-foreground">
                  ถ้าเว้นว่าง ผู้ใช้กรอกค่าอะไรก็ได้ตามชนิดข้อมูล
                </p>
              </div>
            </section>
            </div>

            <section className="flex flex-col gap-3 p-6">
              <SectionLabel>พฤติกรรม</SectionLabel>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                <FlagRow
                  id="param-required"
                  checked={required}
                  onChange={setRequired}
                  label="ต้องกรอก (บังคับกรอก)"
                  hint="ผู้สร้าง Config ต้องใส่ค่านี้ทุกครั้ง"
                />
                <FlagRow
                  id="param-st-overridable"
                  checked={stOverridable}
                  onChange={setStOverridable}
                  label="ช่างหน้างาน (ST) แก้ค่าบนเครื่องได้"
                  hint="ช่าง OT แก้ไม่ได้"
                />
                <FlagRow
                  id="param-sensitive"
                  checked={sensitive}
                  onChange={setSensitive}
                  label="ซ่อนค่า (ค่าอ่อนไหว เช่น รหัสผ่าน)"
                  hint="ซ่อนบนหน้าจอ และตั้งค่าเริ่มต้นไม่ได้"
                />
                <FlagRow
                  id="param-unknown-spec"
                  checked={unknownSpec}
                  onChange={setUnknownSpec}
                  label="ยังไม่ยืนยันรายละเอียด"
                  hint="รู้แค่ชื่อกับชนิดข้อมูล ติดป้ายไว้ให้รู้"
                />
              </div>
            </section>
          </div>

        </div>
      </Card>

      <div className="sticky bottom-0 z-(--z-sticky) -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="min-w-0 text-sm">
          {formError ? (
            <div role="alert" className="flex flex-col gap-0.5 text-destructive">
              <span>{formError}</span>
              {formErrorList.length > 0 && (
                <ul className="list-disc pl-5 text-xs">
                  {formErrorList.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {missing.length > 0 ? `ยังขาด: ${missing.join(", ")}` : "ข้อมูลครบ พร้อมบันทึก"}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (confirmLeave()) onCancel();
            }}
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

/**
 * เลือกโมเดลแบบค้นหาได้ (รองรับโมเดลจำนวนมาก): ปุ่มเปิดรายการที่ค้นหา/เลื่อนได้ + ชิปของที่เลือกไว้
 * ลบทีละตัวได้ · "เลือกที่แสดงทั้งหมด" ทำงานกับผลค้นหาปัจจุบัน
 */
function ModelPicker({
  models,
  selected,
  onToggle,
  onSetMany,
}: {
  models: DeviceModel[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onSetMany: (names: string[], on: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = models.filter(
    (m) =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.supportedProtocols.some((p) => p.toLowerCase().includes(q)),
  );
  const chosen = models.filter((m) => selected.has(m.name));

  if (models.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        ยังไม่มีโมเดลในระบบ เพิ่มโมเดลก่อน
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Popover>
          <PopoverTrigger
            render={
              <Button type="button" variant="outline">
                <PlusIcon />
                เลือกโมเดล
              </Button>
            }
          />
          <PopoverContent className="flex w-80 flex-col gap-2 p-2" align="start">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาโมเดลหรือโปรโตคอล"
              aria-label="ค้นหาโมเดล"
              autoComplete="off"
              className="h-8"
            />
            <div className="flex max-h-64 flex-col overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  ไม่พบโมเดลที่ตรงกับคำค้น
                </p>
              ) : (
                visible.map((m) => (
                  <label
                    key={m.id}
                    htmlFor={`param-model-${m.id}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      id={`param-model-${m.id}`}
                      checked={selected.has(m.name)}
                      onCheckedChange={() => onToggle(m.name)}
                    />
                    <span className="font-instrument">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({m.supportedProtocols.join(", ")})
                    </span>
                    {m.status === "discontinued" && (
                      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">
                        เลิกผลิต
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={visible.length === 0}
                onClick={() => onSetMany(visible.map((m) => m.name), true)}
              >
                เลือกที่แสดงทั้งหมด ({visible.length})
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={chosen.length === 0}
                onClick={() => onSetMany(chosen.map((m) => m.name), false)}
              >
                ล้าง
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {chosen.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          ยังไม่ได้เลือกโมเดล เลือกอย่างน้อย 1 โมเดล
        </p>
      ) : (
        <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label="โมเดลที่เลือกแล้ว">
          {chosen.map((m) => (
            <li
              key={m.id}
              className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 py-0.5 pr-1 pl-2 text-sm"
            >
              <span className="font-instrument">{m.name}</span>
              <span className="text-xs text-muted-foreground">
                ({m.supportedProtocols.join(", ")})
              </span>
              <button
                type="button"
                onClick={() => onToggle(m.name)}
                aria-label={`เอา ${m.name} ออก`}
                className="rounded p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="label-caps text-muted-foreground">{children}</h3>;
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
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
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
