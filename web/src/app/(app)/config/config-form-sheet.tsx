"use client";

import { useMemo, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

export type ConfigFormState =
  | { mode: "create" }
  | { mode: "edit"; config: Config };

/** ฟอร์มสร้าง/แก้ Config — field editor สร้างจาก `GET /config-definitions`
 * กรองตาม (deviceModel, protocol) ที่เลือก · รุ่น/โปรโตคอล **ล็อกตอนแก้**
 * (แก้ได้แค่ตอนสร้าง — ดูมติ PR 3b) · validate ฝั่ง client แบบเบา (required +
 * allowedValues) ที่เหลือพึ่ง 400 จาก backend (`validateFields`) */
export function ConfigFormSheet({
  state,
  onOpenChange,
  onSaved,
}: {
  state: ConfigFormState | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (config: Config) => void;
}) {
  return (
    <Sheet open={state !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {state && (
          <ConfigFormContent
            key={state.mode === "edit" ? state.config.id : "create"}
            state={state}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function modelKeyOf(deviceModel: string, protocol: string): string {
  return `${deviceModel}/${protocol}`;
}

function ConfigFormContent({
  state,
  onSaved,
}: {
  state: ConfigFormState;
  onSaved: (config: Config) => void;
}) {
  const { session } = useAuth();
  const {
    data: defs,
    isLoading,
    error: defsError,
    refetch,
  } = useConfigDefinitions();

  const editing = state.mode === "edit" ? state.config : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [modelKey, setModelKey] = useState(
    editing ? modelKeyOf(editing.deviceModel, editing.protocol) : "",
  );
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    if (!editing) return {};
    const out: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(editing.fields)) {
      out[k] = typeof v === "boolean" ? v : String(v);
    }
    return out;
  });

  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorList, setFormErrorList] = useState<string[]>([]);
  const [missingRequired, setMissingRequired] = useState<string[]>([]);

  /** คู่ (deviceModel, protocol) ที่มี field definition รองรับอย่างน้อย 1 ตัว */
  const modelOptions = useMemo(() => {
    const map = new Map<string, { deviceModel: string; protocol: string }>();
    for (const d of defs ?? []) {
      for (const m of d.supportedModels) {
        map.set(modelKeyOf(m.deviceModel, m.protocol), m);
      }
    }
    return [...map.values()].sort((a, b) =>
      modelKeyOf(a.deviceModel, a.protocol).localeCompare(
        modelKeyOf(b.deviceModel, b.protocol),
      ),
    );
  }, [defs]);

  /** field ที่ใช้กับรุ่น/โปรโตคอลที่เลือก — required ขึ้นก่อน แล้วเรียงชื่อ */
  const applicableDefs = useMemo(() => {
    if (!modelKey) return [] as ConfigFieldDefinition[];
    const [deviceModel, protocol] = modelKey.split("/");
    return (defs ?? [])
      .filter((d) =>
        d.supportedModels.some(
          (m) => m.deviceModel === deviceModel && m.protocol === protocol,
        ),
      )
      .sort(
        (a, b) =>
          Number(b.required) - Number(a.required) ||
          a.fieldName.localeCompare(b.fieldName),
      );
  }, [defs, modelKey]);

  /** ล้าง error ทั้งหมดทันทีที่ผู้ใช้เริ่มแก้ฟอร์ม — validate ใหม่ตอน submit
   * (กัน banner "ยังไม่ได้กรอก..." / error จาก backend ค้างทั้งที่แก้ไปแล้ว) */
  function clearErrors() {
    setNameError(null);
    setFormError(null);
    setFormErrorList([]);
  }

  function setValue(fieldName: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
    setMissingRequired((prev) => prev.filter((f) => f !== fieldName));
    clearErrors();
  }

  function isEmpty(value: FieldValue | undefined): boolean {
    return value === undefined || value === "";
  }

  /** แปลง values -> payload.fields: coerce ตาม dataType, ตัด field ที่ปล่อยว่าง */
  function buildFields(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const def of applicableDefs) {
      const raw = values[def.fieldName];
      if (def.dataType === "boolean") {
        // required boolean: ส่งเสมอ (false ก็เป็นค่าที่ valid) · optional: ส่งเฉพาะติ๊ก
        if (def.required) out[def.fieldName] = raw === true;
        else if (raw === true) out[def.fieldName] = true;
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
    setNameError(null);
    setFormError(null);
    setFormErrorList([]);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("ต้องตั้งชื่อ Config");
      return;
    }
    if (trimmedName.length > 120) {
      setNameError("ชื่อยาวเกิน 120 ตัวอักษร");
      return;
    }
    if (!modelKey) {
      setFormError("เลือกรุ่นอุปกรณ์ / โปรโตคอลก่อน");
      return;
    }

    const missing = applicableDefs
      .filter((d) => d.required && d.dataType !== "boolean")
      .filter((d) => isEmpty(values[d.fieldName]))
      .map((d) => d.fieldName);
    if (missing.length > 0) {
      setMissingRequired(missing);
      setFormError(`ยังไม่ได้กรอก field ที่บังคับ: ${missing.join(", ")}`);
      return;
    }

    if (!session?.accessToken) return;
    const [deviceModel, protocol] = modelKey.split("/");
    const fields = buildFields();

    setSubmitting(true);
    try {
      const saved = editing
        ? await updateConfig(session.accessToken, editing.id, {
            name: trimmedName,
            fields,
          })
        : await createConfig(session.accessToken, {
            name: trimmedName,
            deviceModel,
            protocol,
            fields,
          });
      onSaved(saved);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.statusCode === 409) {
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

  const title = editing ? `แก้ไข ${editing.name}` : "สร้าง Config ใหม่";

  return (
    <>
      <SheetHeader>
        <SheetTitle className="break-words pr-8">{title}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        {isLoading && !defs ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            กำลังโหลดคลัง Parameter…
          </p>
        ) : defsError ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">{defsError}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : (
          <>
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
              <Label htmlFor="config-model">รุ่นอุปกรณ์ / โปรโตคอล</Label>
              <select
                id="config-model"
                value={modelKey}
                disabled={!!editing}
                onChange={(e) => {
                  setModelKey(e.target.value);
                  setMissingRequired([]);
                  clearErrors();
                }}
                className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30"
              >
                <option value="">— เลือก —</option>
                {modelOptions.map((m) => {
                  const k = modelKeyOf(m.deviceModel, m.protocol);
                  return (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  );
                })}
              </select>
              {editing && (
                <p className="text-xs text-muted-foreground">
                  แก้รุ่น/โปรโตคอลไม่ได้หลังสร้างแล้ว — ถ้าเลือกผิด ให้ลบ draft
                  แล้วสร้างใหม่
                </p>
              )}
            </div>

            {modelKey && (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">
                  พารามิเตอร์{" "}
                  <span className="text-muted-foreground">
                    ({applicableDefs.length})
                  </span>
                </p>
                {applicableDefs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    ยังไม่มี field definition สำหรับรุ่นนี้ในคลัง Parameter
                  </p>
                ) : (
                  applicableDefs.map((def) => (
                    <FieldInput
                      key={def.id}
                      def={def}
                      value={values[def.fieldName]}
                      missing={missingRequired.includes(def.fieldName)}
                      onChange={(v) => setValue(def.fieldName, v)}
                    />
                  ))
                )}
              </div>
            )}

            {formError && (
              <div className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm text-destructive">{formError}</p>
                {formErrorList.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-destructive">
                    {formErrorList.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <SheetFooter>
        <Button onClick={handleSubmit} disabled={submitting || isLoading}>
          {submitting
            ? "กำลังบันทึก…"
            : editing
              ? "บันทึกการแก้ไข"
              : "สร้าง Config"}
        </Button>
      </SheetFooter>
    </>
  );
}

function FieldInput({
  def,
  value,
  missing,
  onChange,
}: {
  def: ConfigFieldDefinition;
  value: FieldValue | undefined;
  missing: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const id = `field-${def.fieldName}`;
  const hint = def.description ?? formatModelSupport(def.supportedModels);
  const inputClass =
    "h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

  if (def.dataType === "boolean") {
    return (
      <label className="flex items-start gap-2.5" htmlFor={id}>
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(c) => onChange(c === true)}
          className="mt-0.5"
        />
        <span className="flex flex-col">
          <span className="font-mono text-sm">
            {def.fieldName}
            {def.required && <span className="text-destructive"> *</span>}
          </span>
          {hint && (
            <span className="text-xs text-muted-foreground">{hint}</span>
          )}
        </span>
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-mono">
        {def.fieldName}
        {def.required && <span className="text-destructive"> *</span>}
      </Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {def.allowedValues.length > 0 ? (
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
      ) : (
        <Input
          id={id}
          type={def.dataType === "number" ? "number" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={missing ? true : undefined}
        />
      )}
    </div>
  );
}
