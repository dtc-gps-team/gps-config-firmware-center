"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { createConfig, updateConfig, type Config } from "@/lib/config-api";
import {
  formatModelSupport,
  type ConfigFieldDefinition,
} from "@/lib/config-definition-api";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";

type FieldValue = string | boolean;

export type ConfigWizardMode =
  | { kind: "create" }
  | { kind: "edit"; config: Config };

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

function isEmpty(value: FieldValue | undefined): boolean {
  return value === undefined || value === "";
}

/**
 * ฟอร์มสร้าง/แก้ Config แบบ 2 ขั้น (ตาม wireframe frame 07–08 ที่พี่เลี้ยง
 * approve):
 *   ขั้น 1 — ข้อมูลพื้นฐาน (ชื่อ / รุ่น / โปรโตคอล)
 *   ขั้น 2 — เลือก Parameter จากคลังด้านซ้าย มาใส่ค่าใน Template ด้านขวา
 *
 * required field ถูกใส่ให้อัตโนมัติและถอดไม่ได้ · รุ่น/โปรโตคอล **ล็อกตอนแก้**
 * (แก้ได้แค่ตอนสร้าง — มติ PR 3b) · validate ฝั่ง client แบบเบา (required +
 * allowedValues) ที่เหลือพึ่ง 400 จาก backend (`validateFields`)
 *
 * customer toggle / คำอธิบาย / unit ใน wireframe ตัดออกจาก PR นี้ — ต้องมี
 * field ใน backend ก่อน (เก็บเป็น follow-up)
 */
export function ConfigWizard({ mode }: { mode: ConfigWizardMode }) {
  const router = useRouter();
  const { session } = useAuth();
  const { data: defs, isLoading, error: defsError, refetch } =
    useConfigDefinitions();

  const editing = mode.kind === "edit" ? mode.config : null;

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [deviceModel, setDeviceModel] = useState(editing?.deviceModel ?? "");
  const [protocol, setProtocol] = useState(editing?.protocol ?? "");
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    if (!editing) return {};
    const out: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(editing.fields)) {
      out[k] = typeof v === "boolean" ? v : String(v);
    }
    return out;
  });
  const [selected, setSelected] = useState<string[]>(() =>
    editing ? Object.keys(editing.fields) : [],
  );

  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorList, setFormErrorList] = useState<string[]>([]);
  const [missingRequired, setMissingRequired] = useState<string[]>([]);

  function clearErrors() {
    setNameError(null);
    setFormError(null);
    setFormErrorList([]);
  }

  /** รุ่นอุปกรณ์ที่มี field definition รองรับอย่างน้อย 1 ตัว */
  const deviceModelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of defs ?? []) {
      for (const m of d.supportedModels) set.add(m.deviceModel);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [defs]);

  /** โปรโตคอลที่รองรับสำหรับรุ่นที่เลือก */
  const protocolOptions = useMemo(() => {
    if (!deviceModel) return [] as string[];
    const set = new Set<string>();
    for (const d of defs ?? []) {
      for (const m of d.supportedModels) {
        if (m.deviceModel === deviceModel) set.add(m.protocol);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [defs, deviceModel]);

  /** field ทั้งหมดที่ใช้กับรุ่น/โปรโตคอลที่เลือก */
  const applicableDefs = useMemo(() => {
    if (!deviceModel || !protocol) return [] as ConfigFieldDefinition[];
    return (defs ?? []).filter((d) =>
      d.supportedModels.some(
        (m) => m.deviceModel === deviceModel && m.protocol === protocol,
      ),
    );
  }, [defs, deviceModel, protocol]);

  /** field ที่อยู่ใน Template ตอนนี้ — required เข้าเสมอ + optional ที่ผู้ใช้เพิ่ม */
  const chosenDefs = useMemo(() => {
    const picked = new Set(selected);
    return applicableDefs
      .filter((d) => d.required || picked.has(d.fieldName))
      .sort(
        (a, b) =>
          Number(b.required) - Number(a.required) ||
          a.fieldName.localeCompare(b.fieldName),
      );
  }, [applicableDefs, selected]);

  /** field ในคลังด้านซ้ายที่ยังไม่ได้เพิ่ม (optional เท่านั้น) + กรองด้วยคำค้น */
  const libraryDefs = useMemo(() => {
    const picked = new Set(selected);
    const q = search.trim().toLowerCase();
    return applicableDefs
      .filter((d) => !d.required && !picked.has(d.fieldName))
      .filter(
        (d) =>
          !q ||
          d.fieldName.toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => a.fieldName.localeCompare(b.fieldName));
  }, [applicableDefs, selected, search]);

  function changeDeviceModel(next: string) {
    if (editing) return;
    setDeviceModel(next);
    setProtocol("");
    setSelected([]);
    setValues({});
    setMissingRequired([]);
    clearErrors();
  }

  function changeProtocol(next: string) {
    if (editing) return;
    setProtocol(next);
    setSelected([]);
    setValues({});
    setMissingRequired([]);
    clearErrors();
  }

  function setValue(fieldName: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
    setMissingRequired((prev) => prev.filter((f) => f !== fieldName));
    clearErrors();
  }

  function addField(fieldName: string) {
    setSelected((prev) => (prev.includes(fieldName) ? prev : [...prev, fieldName]));
    clearErrors();
  }

  function removeField(fieldName: string) {
    setSelected((prev) => prev.filter((f) => f !== fieldName));
    setValues((prev) => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
    setMissingRequired((prev) => prev.filter((f) => f !== fieldName));
    clearErrors();
  }

  function goToStep2() {
    clearErrors();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("ต้องตั้งชื่อ Config");
      return;
    }
    if (trimmed.length > 120) {
      setNameError("ชื่อยาวเกิน 120 ตัวอักษร");
      return;
    }
    if (!deviceModel || !protocol) {
      setFormError("เลือกรุ่นอุปกรณ์ / โปรโตคอลก่อน");
      return;
    }
    setStep(2);
  }

  function buildFields(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const def of chosenDefs) {
      const raw = values[def.fieldName];
      if (def.dataType === "boolean") {
        out[def.fieldName] = raw === true;
        continue;
      }
      if (isEmpty(raw)) continue;
      if (def.dataType === "number") {
        const n = Number(raw);
        out[def.fieldName] = Number.isNaN(n) ? raw : n;
      } else {
        out[def.fieldName] = String(raw);
      }
    }
    return out;
  }

  async function handleSubmit() {
    clearErrors();

    const trimmed = name.trim();
    if (!trimmed) {
      setStep(1);
      setNameError("ต้องตั้งชื่อ Config");
      return;
    }

    const missing = chosenDefs
      .filter((d) => d.required && d.dataType !== "boolean")
      .filter((d) => isEmpty(values[d.fieldName]))
      .map((d) => d.fieldName);
    if (missing.length > 0) {
      setMissingRequired(missing);
      setFormError(`ยังไม่ได้กรอก field ที่บังคับ: ${missing.join(", ")}`);
      return;
    }

    if (!session?.accessToken) return;
    const fields = buildFields();
    const trimmedDesc = description.trim();

    setSubmitting(true);
    try {
      const saved = editing
        ? await updateConfig(session.accessToken, editing.id, {
            name: trimmed,
            fields,
            // ส่งเสมอตอนแก้ — "" = ล้างคำอธิบายเดิม
            description: trimmedDesc,
          })
        : await createConfig(session.accessToken, {
            name: trimmed,
            deviceModel,
            protocol,
            fields,
            ...(trimmedDesc ? { description: trimmedDesc } : {}),
          });
      router.push(`/config?saved=${encodeURIComponent(saved.id)}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.statusCode === 409) {
        setStep(1);
        setNameError(err.message);
        return;
      }
      if (err instanceof ApiError) {
        setFormError(err.message);
        setFormErrorList(err.details ?? []);
        return;
      }
      setFormError("บันทึก Config ไม่สำเร็จ");
    }
  }

  if (isLoading && !defs) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลดคลัง Parameter…
      </p>
    );
  }

  if (defsError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{defsError}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator step={step} />

      {step === 1 ? (
        <div className="flex max-w-xl flex-col gap-5 rounded-xl border bg-card p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-name">ชื่อ Config</Label>
            <Input
              id="config-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearErrors();
              }}
              maxLength={120}
              placeholder="เช่น GT06N · ตั้งค่ามาตรฐานภาคกลาง"
              aria-invalid={nameError ? true : undefined}
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-device-model">รุ่นอุปกรณ์</Label>
            <select
              id="config-device-model"
              value={deviceModel}
              disabled={!!editing}
              onChange={(e) => changeDeviceModel(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">— เลือก —</option>
              {deviceModelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-protocol">โปรโตคอล</Label>
            <select
              id="config-protocol"
              value={protocol}
              disabled={!!editing || !deviceModel}
              onChange={(e) => changeProtocol(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">— เลือก —</option>
              {protocolOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {editing && (
            <p className="text-xs text-muted-foreground">
              แก้รุ่น/โปรโตคอลไม่ได้หลังสร้างแล้ว — ถ้าเลือกผิด ให้ลบ draft
              แล้วสร้างใหม่
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-description">
              คำอธิบาย{" "}
              <span className="font-normal text-muted-foreground">
                (ไม่บังคับ)
              </span>
            </Label>
            <textarea
              id="config-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearErrors();
              }}
              maxLength={500}
              rows={3}
              placeholder="อธิบายวัตถุประสงค์ของ Config ชุดนี้…"
              className="min-h-16 resize-y rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>

          {formError && <ErrorBanner message={formError} list={formErrorList} />}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => router.push("/config")}>
              ยกเลิก
            </Button>
            <Button onClick={goToStep2}>ถัดไป: เลือก Parameter →</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{name.trim()}</span>
            <span>·</span>
            <span>
              {deviceModel} · {protocol}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-[300px_1fr]">
            <section className="flex max-h-[32rem] flex-col overflow-hidden rounded-xl border bg-card">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium">คลัง Parameter</p>
                <p className="text-xs text-muted-foreground">
                  คลิกเพื่อเพิ่มเข้า Template
                </p>
              </div>
              <div className="px-3 py-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหา parameter…"
                  className="h-8"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
                {libraryDefs.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {applicableDefs.length === 0
                      ? "ยังไม่มี field definition สำหรับรุ่นนี้"
                      : "เพิ่มครบทุก parameter แล้ว"}
                  </p>
                ) : (
                  libraryDefs.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => addField(def.fieldName)}
                      className="flex items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"
                    >
                      <PlusIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-medium">
                            {def.fieldName}
                          </span>
                          <span className="rounded-full bg-secondary px-1.5 text-[0.65rem] text-secondary-foreground">
                            {def.dataType}
                          </span>
                        </span>
                        {def.description && (
                          <span className="text-xs text-muted-foreground">
                            {def.description}
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="flex flex-col overflow-hidden rounded-xl border bg-card">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium">
                  Config Template{" "}
                  <span className="text-muted-foreground">
                    ({chosenDefs.length})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {deviceModel} · {protocol} · field ที่บังคับถอดไม่ได้
                </p>
              </div>
              <div className="flex flex-col gap-2.5 p-4">
                {chosenDefs.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    เลือก Parameter จากคลังด้านซ้ายมาเริ่มได้เลย
                  </p>
                ) : (
                  chosenDefs.map((def) => (
                    <TemplateRow
                      key={def.id}
                      def={def}
                      value={values[def.fieldName]}
                      missing={missingRequired.includes(def.fieldName)}
                      onChange={(v) => setValue(def.fieldName, v)}
                      onRemove={
                        def.required
                          ? undefined
                          : () => removeField(def.fieldName)
                      }
                    />
                  ))
                )}
              </div>
            </section>
          </div>

          {formError && <ErrorBanner message={formError} list={formErrorList} />}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setStep(1)}>
              ← ย้อนกลับ
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? "กำลังบันทึก…"
                : editing
                  ? "บันทึกการแก้ไข"
                  : "บันทึก Config Draft"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  const steps = [
    { n: 1, label: "ข้อมูลพื้นฐาน" },
    { n: 2, label: "เลือก Parameter" },
  ];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-8 bg-border" />}
            <span
              className={
                "flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs font-medium " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground")
              }
            >
              <span
                className={
                  "flex size-5 items-center justify-center rounded-full text-[0.65rem] " +
                  (active
                    ? "bg-primary-foreground text-primary"
                    : "bg-border text-muted-foreground")
                }
              >
                {done ? <CheckIcon className="size-3" /> : s.n}
              </span>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ErrorBanner({
  message,
  list,
}: {
  message: string;
  list: string[];
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm text-destructive">{message}</p>
      {list.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-destructive">
          {list.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateRow({
  def,
  value,
  missing,
  onChange,
  onRemove,
}: {
  def: ConfigFieldDefinition;
  value: FieldValue | undefined;
  missing: boolean;
  onChange: (value: FieldValue) => void;
  onRemove?: () => void;
}) {
  const id = `field-${def.fieldName}`;
  const hint = def.description ?? formatModelSupport(def.supportedModels);
  const inputClass =
    "h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <Label htmlFor={id} className="font-mono text-xs">
          {def.fieldName}
          {def.required ? (
            <span className="text-destructive"> *</span>
          ) : null}
        </Label>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`เอา ${def.fieldName} ออก`}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : (
          <span className="text-[0.65rem] text-muted-foreground">บังคับ</span>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {def.dataType === "boolean" ? (
        <label className="flex items-center gap-2 text-sm" htmlFor={id}>
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
          />
          เปิดใช้งาน
        </label>
      ) : def.allowedValues.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={missing ? true : undefined}
            className={inputClass}
          >
            <option value="">— เลือก —</option>
            {def.allowedValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {def.unit && <UnitLabel unit={def.unit} />}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type={def.dataType === "number" ? "number" : "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={missing ? true : undefined}
          />
          {def.unit && <UnitLabel unit={def.unit} />}
        </div>
      )}
    </div>
  );
}

function UnitLabel({ unit }: { unit: string }) {
  return (
    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
      {unit}
    </span>
  );
}
