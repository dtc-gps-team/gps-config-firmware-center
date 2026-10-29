"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeIcon, ListIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SensitiveInput } from "@/components/sensitive-value";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { createConfig, updateConfig, type Config } from "@/lib/config-api";
import {
  formatModelSupport,
  type ConfigFieldDefinition,
} from "@/lib/config-definition-api";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useDeviceModels } from "@/hooks/use-device-models";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";
import { WizardStepIndicator } from "@/components/wizard-step-indicator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DiffCounts, DiffViewer } from "@/components/diff-viewer";
import { ErrorState } from "@/components/error-state";
import { diffConfigFields } from "@/lib/config-diff";
import { validateFieldValue } from "@/lib/config-field-validation";
import {
  maskSensitiveFields,
  parseRawFields,
  SENSITIVE_MASK,
  tokenizeJson,
  type JsonTokenKind,
} from "@/lib/config-raw";
import { cn } from "@/lib/utils";

type FieldValue = string | boolean;

export type ConfigWizardMode =
  | { kind: "create"; cloneFrom?: Config }
  | { kind: "edit"; config: Config };

function isEmpty(value: FieldValue | undefined): boolean {
  return value === undefined || value === "";
}

/** `integer`/`decimal` คือ 2 ชนิดเดียวในชุด dataType (มติ issue #201,
 * อัปเดต 2026-09-22) ที่เก็บเป็นค่าตัวเลขจริง (`number`) ตอน submit — ชนิดอื่น
 * ทั้งหมด (string/text/date/datetime/json/array/uuid) เก็บเป็น string ดิบ
 * เสมอ ยังไม่มี input widget พิเศษให้ (date-picker/JSON editor ฯลฯ) ตั้งใจ
 * เหลือไว้เป็นช่องว่างนอกขอบเขตรอบนี้ — validate ชนิดจริงฝั่ง backend ตอน
 * submit
 *
 * **`'number'` (แก้ตามรีวิว B บน PR #255 ข้อ 3 รอบ 2):** field เก่าที่ยังไม่
 * ผ่าน backfill (ช่วงหลัง deploy โค้ดใหม่แต่ยังไม่ได้รัน `db seed`) ยังมี
 * `dataType` เดิมเป็น `'number'` อยู่ — ถ้าไม่รวมไว้ที่นี่ input จะ render เป็น
 * `type="text"` แล้วส่งค่าเป็น **string** (`"8080"`) ไปให้ backend ซึ่ง
 * `matchesDataType()` ฝั่งนั้นคง `case 'number'` ไว้แบบ explicit ด้วยเหตุผล
 * เดียวกัน (เช็ค `typeof === 'number'`) ไม่ทำแบบนี้แล้ว string จะโดน 400 ทันที
 * — mirror กันไว้ทั้งสองฝั่งจนกว่า backfill จะรันจริง ไม่ใช่ค่าที่เลือกสร้าง
 * field ใหม่ได้แล้ว (ตัด `number` ออกจาก dropdown ใน `parameter-create-form.tsx`) */
function isNumericDataType(dataType: string): boolean {
  return (
    dataType === "integer" || dataType === "decimal" || dataType === "number"
  );
}

/** `json`/`array` คือ 2 ชนิดเดียวที่ backend (`matchesDataType`) ต้องการ
 * object/array จริง ไม่ใช่ string — **แก้ตามรีวิว B บน PR #255 ข้อ 2**: เดิม
 * `buildFields()` เก็บทุกชนิดที่ไม่ใช่ boolean/numeric เป็น `String(raw)` ดิบๆ
 * ทำให้ field ชนิดนี้ 400 ทุกครั้งที่ backend เช็ค `typeof === 'object'`/
 * `Array.isArray()` — parse ให้จริงก่อนส่ง (ยังไม่ validate ชนิดอื่นที่
 * เหลือ — date/datetime/uuid ยังเป็น string ที่ backend เช็ครูปแบบเอง) */
function isJsonDataType(dataType: string): boolean {
  return dataType === "json" || dataType === "array";
}

/** parse ค่า raw เป็น JSON ตาม dataType — คืน `ok: false` ถ้า parse ไม่ขึ้นหรือ
 * ได้ชนิดผิด (เช่น `json` ที่ parse ออกมาเป็น array ก็ไม่ผ่าน ตรงกับ
 * `matchesDataType` ฝั่ง backend ที่แยก object ล้วนกับ array ออกจากกัน) */
function parseJsonField(
  raw: string,
  dataType: "json" | "array",
): { ok: true; value: unknown } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (dataType === "array") {
    return Array.isArray(parsed) ? { ok: true, value: parsed } : { ok: false };
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? { ok: true, value: parsed }
    : { ok: false };
}

/** parse `ConfigFieldDefinition.defaultValue` (string ดิบ) ให้ตรงกับ shape ที่
 * `values` state ใช้เก็บอยู่แล้ว (`FieldValue = string | boolean`) — boolean
 * dataType เก็บเป็น boolean จริง ส่วนที่เหลือเก็บเป็น string เสมอแล้วค่อยแปลง
 * ตอน submit ใน `buildFields()` (เหมือนกับตอน prefill จาก `source.fields`
 * ด้านบน) ตรงกับ dataType-based parse เดียวกับที่ `parseByDataType()` ใน
 * config-override-panel.tsx เคยทำ (ไฟล์นั้นถูกลบไปแล้ว — issue #223, แก้ครั้งที่ 55) ไม่ใช้ฟังก์ชันนั้นตรงๆ เพราะ return
 * type ของมัน (`unknown`, parse เลขเป็น number จริง) ไม่ตรงกับ `FieldValue`
 * ของไฟล์นี้ — logic parse boolean เหมือนกันทุกประการ */
function defaultFieldValue(def: ConfigFieldDefinition): FieldValue | undefined {
  if (def.defaultValue === null || def.defaultValue === undefined) {
    return undefined;
  }
  return def.dataType === "boolean"
    ? def.defaultValue === "true"
    : def.defaultValue;
}

function initialValuesOf(source: Config | null): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  if (!source) return out;
  for (const [k, v] of Object.entries(source.fields)) {
    out[k] = typeof v === "boolean" ? v : String(v);
  }
  return out;
}

const UNCATEGORIZED = "อื่นๆ";

const JSON_TOKEN_CLASS: Record<JsonTokenKind, string> = {
  key: "text-info-foreground",
  string: "text-success-foreground",
  number: "text-warning-foreground",
  literal: "text-primary",
  punct: "text-muted-foreground",
  space: "",
};

/** ข้อความ JSON ระบายสีตามชนิด (อ่านอย่างเดียว) */
function HighlightedJson({ text }: { text: string }) {
  return (
    <pre
      aria-label="ตัวอย่าง JSON ที่ไฮไลต์"
      className="max-h-96 overflow-auto rounded-lg border bg-surface-sunken p-3 font-instrument text-xs leading-relaxed"
    >
      {tokenizeJson(text).map((t, i) => (
        <span key={i} className={JSON_TOKEN_CLASS[t.kind]}>
          {t.text}
        </span>
      ))}
    </pre>
  );
}

/**
 * ฟอร์มสร้าง/แก้ Config แบบ 2 ขั้น (ตาม wireframe frame 07–08 ที่พี่เลี้ยง
 * approve):
 *   ขั้น 1 — ข้อมูลพื้นฐาน (ชื่อ / รุ่น / โปรโตคอล)
 *   ขั้น 2 — เลือก Parameter จากคลังด้านซ้าย มาใส่ค่าใน Template ด้านขวา
 *
 * คลังแสดงชุดค่าเริ่มต้นของรุ่นก่อน ติ๊ก "แสดงพารามิเตอร์ทั้งหมด" แล้วเพิ่ม
 * พารามิเตอร์นอกชุดได้ (รีวิวพี่เลี้ยง 12 ต.ค. 2569) ตัวนอกชุดมีป้ายบอก
 *
 * required field ของรุ่นถูกใส่ให้อัตโนมัติและถอดไม่ได้ · รุ่น/โปรโตคอล **ล็อกตอนแก้**
 * (แก้ได้แค่ตอนสร้าง — มติ PR 3b) · validate ฝั่ง client แบบเบา (required +
 * allowedValues) ที่เหลือพึ่ง 400 จาก backend (`validateFields`)
 *
 * โหมดโคลน (`create` + `cloneFrom`) — prefill ทุกอย่างจาก config ต้นทาง ยกเว้น
 * ชื่อ (ต่อท้าย "(สำเนา)") · รุ่น/โปรโตคอลยังเปลี่ยนได้ (เป็น create ใหม่)
 */
export function ConfigWizard({ mode }: { mode: ConfigWizardMode }) {
  const router = useRouter();
  const { session } = useAuth();
  const { data: defs, isLoading, error: defsError, refetch } =
    useConfigDefinitions();
  const { data: registeredModels } = useDeviceModels();

  const editing = mode.kind === "edit" ? mode.config : null;
  const cloneFrom = mode.kind === "create" ? mode.cloneFrom ?? null : null;
  // ค่าเดิมที่เอามา prefill — โหมดแก้ใช้ config ตัวเอง · โหมดโคลนใช้ config ต้นทาง
  // (โคลน = create ใหม่ ยังเปลี่ยนรุ่น/โปรโตคอลได้ ต่างจากโหมดแก้ที่ล็อก)
  const source = editing ?? cloneFrom;

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(
    editing ? editing.name : cloneFrom ? `${cloneFrom.name} (สำเนา)` : "",
  );
  const [description, setDescription] = useState(source?.description ?? "");
  const [deviceModel, setDeviceModel] = useState(source?.deviceModel ?? "");
  const [protocol, setProtocol] = useState(source?.protocol ?? "");
  const [search, setSearch] = useState("");
  const [showAllParams, setShowAllParams] = useState(false);
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    initialValuesOf(source),
  );
  const [selected, setSelected] = useState<string[]>(() =>
    source ? Object.keys(source.fields) : [],
  );

  // snapshot ตอน mount — เทียบกับค่าปัจจุบันเพื่อรู้ว่ามีการแก้ไขที่ยังไม่ได้
  // บันทึกหรือยัง (ใช้เตือนก่อนออกจากหน้า ด้านล่าง)
  const [initialSnapshot] = useState(() =>
    JSON.stringify({ name, description, deviceModel, protocol, values, selected }),
  );

  const [editorMode, setEditorMode] = useState<"form" | "raw">("form");
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

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

  const isDirty = useMemo(
    () =>
      JSON.stringify({ name, description, deviceModel, protocol, values, selected }) !==
      initialSnapshot,
    [name, description, deviceModel, protocol, values, selected, initialSnapshot],
  );
  const { confirmLeave } = useUnsavedChangesWarning(isDirty);

  /** รุ่นอุปกรณ์ที่มี field definition รองรับอย่างน้อย 1 ตัว */
  const deviceModelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of defs ?? []) {
      for (const m of d.supportedModels) set.add(m.deviceModel);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [defs]);

  /** โปรโตคอลที่เลือกได้ของรุ่นหนึ่ง: ล็อกตามทะเบียนโมเดล (`DeviceModel.
   * supportedProtocols`) เหมือนหน้าลงทะเบียนอุปกรณ์ ไม่ใช่ทุกโปรโตคอลที่มี
   * พารามิเตอร์ · รุ่นที่ยังไม่อยู่ในทะเบียน (ข้อมูลเก่า) ถอยไปใช้โปรโตคอลที่
   * พารามิเตอร์ของรุ่นนั้นรองรับ · โหมดแก้เพิ่มโปรโตคอลเดิมของ Config เข้าไป
   * เสมอ กันช่องที่ล็อกอยู่แสดงค่าว่างถ้าทะเบียนเปลี่ยนไปภายหลัง */
  function protocolsFor(model: string): string[] {
    if (!model) return [];
    const registered = (registeredModels ?? []).find((m) => m.name === model);
    const set = new Set<string>();
    if (registered) {
      for (const p of registered.supportedProtocols) set.add(p);
    } else {
      for (const d of defs ?? []) {
        for (const m of d.supportedModels) {
          if (m.deviceModel === model) set.add(m.protocol);
        }
      }
    }
    if (editing && editing.deviceModel === model) set.add(editing.protocol);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  const protocolOptions = protocolsFor(deviceModel);
  // โมเดลหนึ่งใช้ได้โปรโตคอลเดียว: เลือกให้แล้วล็อกช่อง ไม่ให้เปลี่ยน

  /** field เป็นชุดค่าเริ่มต้นของรุ่น/โปรโตคอลที่เลือกไหม (`supportedModels`) */
  function isInModelSet(d: ConfigFieldDefinition): boolean {
    return d.supportedModels.some(
      (m) => m.deviceModel === deviceModel && m.protocol === protocol,
    );
  }

  /** required บังคับเฉพาะ field ในชุดของรุ่นนี้ field นอกชุดที่ required ของ
   * รุ่นอื่นถือเป็น optional ที่นี่ (ตรงกับ backend `validateFields()`) */
  function isRequiredHere(d: ConfigFieldDefinition): boolean {
    return d.required && isInModelSet(d);
  }

  /** field ในชุดค่าเริ่มต้นของรุ่น/โปรโตคอลที่เลือก */
  const applicableDefs = useMemo(() => {
    if (!deviceModel || !protocol) return [] as ConfigFieldDefinition[];
    return (defs ?? []).filter((d) =>
      d.supportedModels.some(
        (m) => m.deviceModel === deviceModel && m.protocol === protocol,
      ),
    );
  }, [defs, deviceModel, protocol]);

  /** field ที่อยู่ใน Template ตอนนี้ — required ของรุ่นเข้าเสมอ + ที่ผู้ใช้เพิ่ม
   * (รวม field นอกชุดของรุ่น ตามรีวิวพี่เลี้ยง 12 ต.ค. 2569: ผู้สร้าง template
   * เพิ่มพารามิเตอร์นอกชุดได้) */
  const chosenDefs = useMemo(() => {
    if (!deviceModel || !protocol) return [] as ConfigFieldDefinition[];
    const picked = new Set(selected);
    const requiredHere = (d: ConfigFieldDefinition) =>
      d.required &&
      d.supportedModels.some(
        (m) => m.deviceModel === deviceModel && m.protocol === protocol,
      );
    return (defs ?? [])
      .filter((d) => requiredHere(d) || picked.has(d.fieldName))
      .sort(
        (a, b) =>
          Number(requiredHere(b)) - Number(requiredHere(a)) ||
          a.fieldName.localeCompare(b.fieldName),
      );
  }, [defs, deviceModel, protocol, selected]);

  /** ค่าที่ใช้แสดง/บันทึกจริงของ field หนึ่งตัว — ถ้าผู้ใช้ยังไม่เคยแก้ (`values`
   * ไม่มี key นี้) และเป็นการสร้าง Config **ใหม่จริงๆ** (`!source` — ไม่ใช่
   * โหมดแก้/โคลนที่ต้องใช้ค่าจาก Config เดิมเสมอตามมติที่ยืนยันไว้ใน #202)
   * ให้ fallback ไปใช้ `def.defaultValue` แทน — คำนวณตอน render/submit ไม่
   * เขียนลง `values` state ตรงๆ (กัน setState-in-effect) พอผู้ใช้แก้ค่าเอง
   * ผ่าน `setValue()` มันจะเข้า `values` แล้ว fallback นี้จะไม่ทำงานอีกต่อไป —
   * ยังแก้ไขได้ตามปกติ ไม่ล็อก */
  function effectiveValue(def: ConfigFieldDefinition): FieldValue | undefined {
    const v = values[def.fieldName];
    if (v !== undefined) return v;
    return source ? undefined : defaultFieldValue(def);
  }

  /** ค่าที่จะบันทึกจริงตอนนี้ ใช้เทียบกับฉบับเดิมและสร้าง JSON ของโหมด Raw */
  const currentFields = buildFields();
  const currentFieldsKey = JSON.stringify(currentFields);
  const baseFields = source?.fields ?? null;
  const diff = useMemo(
    () => (baseFields ? diffConfigFields(baseFields, JSON.parse(currentFieldsKey)) : null),
    [baseFields, currentFieldsKey],
  );
  const changedNames = useMemo(
    () => new Set(diff?.changes.map((c) => c.fieldName) ?? []),
    [diff],
  );
  const fieldErrors: Record<string, string> = {};
  for (const d of chosenDefs) {
    const err = validateFieldValue(d, effectiveValue(d));
    if (err) fieldErrors[d.fieldName] = err;
  }
  const errorCount = Object.keys(fieldErrors).length;

  /** จัดกลุ่ม Template ตามหมวดของ field ("อื่นๆ" ไว้ท้ายสุด) */
  const groupedDefs = useMemo(() => {
    const groups = new Map<string, ConfigFieldDefinition[]>();
    for (const d of chosenDefs) {
      const key = d.category ?? UNCATEGORIZED;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups.entries()].sort(([a], [b]) =>
      a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b),
    );
  }, [chosenDefs]);

  function resetToInitial() {
    setValues(initialValuesOf(source));
    setSelected(source ? Object.keys(source.fields) : []);
    setMissingRequired([]);
    setRawError(null);
    clearErrors();
    setEditorMode("form");
  }

  function switchToRaw() {
    setRawText(JSON.stringify(maskSensitiveFields(currentFields, defs ?? []), null, 2));
    setRawError(null);
    setEditorMode("raw");
  }

  /** แก้ข้อความ JSON แล้วซิงก์เข้าฟอร์มทันทีเมื่ออ่านได้ ถ้าอ่านไม่ได้แสดงสาเหตุและบล็อกการบันทึก */
  function onRawChange(text: string) {
    setRawText(text);
    const parsed = parseRawFields(text, defs ?? []);
    if (!parsed.ok) {
      setRawError(parsed.error);
      return;
    }
    setRawError(null);
    const nextValues: Record<string, FieldValue> = {};
    const sensitiveNames = new Set(
      (defs ?? []).filter((d) => d.sensitive).map((d) => d.fieldName),
    );
    for (const [k, v] of Object.entries(parsed.fields)) {
      if (sensitiveNames.has(k) && v === SENSITIVE_MASK) {
        // ไม่ได้แตะค่าอ่อนไหว: คงค่าเดิมในฟอร์มไว้
        const keep = effectiveValueByName(k);
        if (keep !== undefined) nextValues[k] = keep;
        continue;
      }
      nextValues[k] =
        typeof v === "boolean"
          ? v
          : typeof v === "object" && v !== null
            ? JSON.stringify(v)
            : String(v);
    }
    setValues(nextValues);
    setSelected(Object.keys(parsed.fields));
    clearErrors();
  }

  function effectiveValueByName(fieldName: string): FieldValue | undefined {
    const d = (defs ?? []).find((x) => x.fieldName === fieldName);
    return d ? effectiveValue(d) : values[fieldName];
  }

  /** field ในคลังด้านซ้ายที่ยังไม่ได้เพิ่ม + กรองด้วยคำค้น ค่าเริ่มต้นแสดงเฉพาะ
   * ชุดของรุ่นนี้ ติ๊ก "แสดงพารามิเตอร์ทั้งหมด" แล้วเห็นทั้งคลัง */
  const libraryDefs = useMemo(() => {
    if (!deviceModel || !protocol) return [] as ConfigFieldDefinition[];
    const picked = new Set(selected);
    const applicable = new Set(applicableDefs.map((d) => d.fieldName));
    const q = search.trim().toLowerCase();
    const base = showAllParams ? (defs ?? []) : applicableDefs;
    return base
      .filter(
        (d) =>
          !(d.required && applicable.has(d.fieldName)) &&
          !picked.has(d.fieldName),
      )
      .filter(
        (d) =>
          !q ||
          d.fieldName.toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          Number(applicable.has(b.fieldName)) -
            Number(applicable.has(a.fieldName)) ||
          a.fieldName.localeCompare(b.fieldName),
      );
  }, [
    defs,
    deviceModel,
    protocol,
    applicableDefs,
    selected,
    search,
    showAllParams,
  ]);

  /** จำนวน field ในคลังที่อยู่นอกชุดของรุ่นนี้ (โชว์ข้างตัวเลือกแสดงทั้งหมด) */
  const outsideSetCount = (defs ?? []).length - applicableDefs.length;

  function changeDeviceModel(next: string) {
    if (editing) return;
    setDeviceModel(next);
    // รุ่นที่รองรับโปรโตคอลเดียวเลือกให้เลย (เหมือนหน้าลงทะเบียนอุปกรณ์)
    const options = protocolsFor(next);
    setProtocol(options.length === 1 ? options[0] : "");
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
      setFormError("เลือกโมเดล / โปรโตคอลก่อน");
      return;
    }
    setStep(2);
  }

  function buildFields(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const def of chosenDefs) {
      const raw = effectiveValue(def);
      if (def.dataType === "boolean") {
        out[def.fieldName] = raw === true;
        continue;
      }
      if (isEmpty(raw)) continue;
      if (isNumericDataType(def.dataType)) {
        const n = Number(raw);
        out[def.fieldName] = Number.isNaN(n) ? raw : n;
      } else if (isJsonDataType(def.dataType)) {
        // เรียกหลัง handleSubmit ตรวจ parseJsonField ผ่านมาแล้วเท่านั้น
        // (ดู invalidJsonFields) — ถ้า parse ไม่ขึ้นจริงๆ fallback เป็น string
        // ดิบไปก่อน (ไม่ควรเกิดขึ้นในทางปฏิบัติ แต่กัน throw กลางฟังก์ชัน)
        const result = parseJsonField(
          String(raw),
          def.dataType as "json" | "array",
        );
        out[def.fieldName] = result.ok ? result.value : String(raw);
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
      .filter((d) => isRequiredHere(d) && d.dataType !== "boolean")
      .filter((d) => isEmpty(effectiveValue(d)))
      .map((d) => d.fieldName);
    if (missing.length > 0) {
      setMissingRequired(missing);
      setFormError(`ยังไม่ได้กรอก field ที่บังคับ: ${missing.join(", ")}`);
      return;
    }

    // แก้ตามรีวิว B บน PR #255 ข้อ 2 — เช็คก่อน submit ว่า field ชนิด
    // json/array ที่กรอกไว้ parse เป็น JSON ที่ถูกต้องตามชนิดจริงไหม (ไม่เช่น
    // นั้น buildFields() จะ fallback เป็น string ดิบแล้วโดน backend 400 โดยไม่
    // มีข้อความอธิบายที่ชัดเจนว่าปัญหาคือ field ไหน) ฟิลด์ที่ว่างไว้ (ไม่
    // required) ข้ามการเช็คนี้ได้ตามปกติ
    const invalidJsonFields = chosenDefs.filter((d) => {
      if (!isJsonDataType(d.dataType)) return false;
      const raw = effectiveValue(d);
      if (isEmpty(raw)) return false;
      return !parseJsonField(String(raw), d.dataType as "json" | "array").ok;
    });
    if (invalidJsonFields.length > 0) {
      setMissingRequired(invalidJsonFields.map((d) => d.fieldName));
      const names = invalidJsonFields
        .map((d) => `${d.fieldName} (${d.dataType})`)
        .join(", ");
      setFormError(
        `ค่าของ field ต่อไปนี้ไม่ใช่ JSON ที่ถูกต้องตามชนิดข้อมูล: ${names}`,
      );
      return;
    }

    if (rawError) {
      setFormError("แก้ JSON ให้ถูกต้องก่อนบันทึก");
      return;
    }
    if (errorCount > 0) {
      setFormError(
        `มี ${errorCount} ค่าที่ยังไม่ถูกต้อง แก้ตามที่แจ้งใต้แต่ละช่องก่อนบันทึก`,
      );
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
            // โหมดโคลน: บอก backend ว่าต้นทางคือตัวไหน เพื่อให้หน้าอนุมัติเทียบ
            // ค่าเก่ากับค่าใหม่ได้ (ตั้งได้ครั้งเดียวตอนสร้าง ไม่ส่งตอนแก้)
            ...(cloneFrom ? { clonedFromId: cloneFrom.id } : {}),
          });
      toast.success(editing ? `บันทึก "${saved.name}" แล้ว` : `สร้าง "${saved.name}" แล้ว`);
      router.push(`/config?saved=${encodeURIComponent(saved.id)}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.statusCode === 409) {
        setStep(1);
        setNameError(err.message);
        toast.error(err.message);
        return;
      }
      if (err instanceof ApiError) {
        setFormError(err.message);
        setFormErrorList(err.details ?? []);
        toast.error(err.message);
        return;
      }
      setFormError("บันทึก Config ไม่สำเร็จ");
      toast.error("บันทึก Config ไม่สำเร็จ");
    }
  }

  if (isLoading && !defs) {
    return <DetailSkeleton lines={6} />;
  }

  if (defsError) {
    return <ErrorState message={defsError} onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <WizardStepIndicator steps={CONFIG_WIZARD_STEPS} step={step} />

      {step === 1 ? (
        <div className="grid w-full max-w-5xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="gap-5 p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">ข้อมูลทั่วไป</h2>
              <p className="text-sm text-muted-foreground">
                ตั้งชื่อให้ค้นหาง่าย และบอกว่า Config ชุดนี้ไว้ทำอะไร
              </p>
            </div>

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
                placeholder="เช่น GT06N ตั้งค่ามาตรฐานภาคกลาง"
                aria-invalid={nameError ? true : undefined}
              />
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
            </div>

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
                rows={5}
                placeholder="อธิบายวัตถุประสงค์ของ Config ชุดนี้…"
                className="min-h-28 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
              <p className="text-right text-xs tabular-nums text-muted-foreground">
                {description.length} / 500
              </p>
            </div>
          </Card>

          <Card className="gap-4 p-6 lg:sticky lg:top-24">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">อุปกรณ์เป้าหมาย</h2>
              <p className="text-sm text-muted-foreground">
                เลือกแล้วระบบจะแสดงพารามิเตอร์ที่รุ่นนี้ใช้ในขั้นถัดไป
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="config-device-model">โมเดล</Label>
              <Select
                value={deviceModel}
                disabled={!!editing}
                onValueChange={(value) => changeDeviceModel(value ?? "")}
              >
                <SelectTrigger id="config-device-model" className="w-full">
                  <SelectValue placeholder="- เลือก -" />
                </SelectTrigger>
                <SelectContent>
                  {deviceModelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="config-protocol">โปรโตคอล</Label>
              <Select
                value={protocol}
                disabled={
                  !!editing || !deviceModel || protocolOptions.length === 1
                }
                onValueChange={(value) => changeProtocol(value ?? "")}
              >
                <SelectTrigger id="config-protocol" className="w-full">
                  <SelectValue placeholder="- เลือก -" />
                </SelectTrigger>
                <SelectContent>
                  {protocolOptions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {deviceModel && protocol && (
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-sunken p-3 text-center">
                <div className="flex flex-col">
                  <span className="text-lg font-semibold tabular-nums">
                    {applicableDefs.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    พารามิเตอร์ของรุ่นนี้
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-lg font-semibold tabular-nums">
                    {applicableDefs.filter((d) => d.required).length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ที่ต้องกรอก
                  </span>
                </div>
              </div>
            )}

            {editing && (
              <p className="text-xs text-muted-foreground">
                แก้โมเดล/โปรโตคอลไม่ได้หลังสร้างแล้ว ถ้าเลือกผิด ให้ลบ draft
                แล้วสร้างใหม่
              </p>
            )}
          </Card>

          <div className="flex flex-col gap-4 lg:col-span-2">
            {formError && <ErrorBanner message={formError} list={formErrorList} />}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  if (confirmLeave()) router.push("/config");
                }}
              >
                ยกเลิก
              </Button>
              <Button onClick={goToStep2}>ถัดไป: เลือก Parameter →</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-base font-semibold">{name.trim()}</span>
              <span className="text-xs text-muted-foreground">
                {deviceModel} / {protocol}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
              <span className="rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
                เลือกแล้ว {chosenDefs.length}
              </span>
              {diff && diff.changes.length > 0 && (
                <span className="rounded-full bg-info-subtle px-2.5 py-1 text-info-foreground">
                  แก้ไข {diff.changes.length}
                </span>
              )}
              {errorCount > 0 && (
                <span className="rounded-full bg-danger-subtle px-2.5 py-1 text-danger-foreground">
                  ผิดพลาด {errorCount}
                </span>
              )}
            </div>
          </div>

          <div className="grid items-start gap-4 md:grid-cols-[20rem_minmax(0,1fr)]">
            <Card className="gap-0 py-0 md:sticky md:top-24 md:max-h-[calc(100vh-10rem)]">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium">คลัง Parameter</p>
                <p className="text-xs text-muted-foreground">
                  คลิกเพื่อเพิ่มเข้า Template
                </p>
              </div>
              <div className="flex flex-col gap-2 px-3 py-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหา parameter…"
                  className="h-8"
                />
                {outsideSetCount > 0 && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={showAllParams}
                      onCheckedChange={(c) => setShowAllParams(c === true)}
                    />
                    แสดงพารามิเตอร์ทั้งหมด (นอกชุดของโมเดลนี้ {outsideSetCount}{" "}
                    ตัว)
                  </label>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
                {libraryDefs.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {search.trim()
                      ? "ไม่พบ parameter ที่ค้นหา"
                      : !showAllParams && applicableDefs.length === 0
                        ? "ยังไม่มี parameter ในชุดของโมเดลนี้ ติ๊กแสดงพารามิเตอร์ทั้งหมดเพื่อเลือกจากทั้งคลัง"
                        : "เพิ่มครบทุก parameter แล้ว"}
                  </p>
                ) : (
                  libraryDefs.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => addField(def.fieldName)}
                      className="flex items-start gap-2 rounded-lg border border-transparent px-2 py-2 text-left outline-none transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <PlusIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-instrument text-xs font-medium break-all">
                            {def.fieldName}
                          </span>
                          <span className="rounded-full bg-secondary px-1.5 text-[0.65rem] text-secondary-foreground">
                            {def.dataType}
                          </span>
                          {!isInModelSet(def) && <OutsideSetBadge />}
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
            </Card>

            <Card className="gap-0 py-0">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    Config Template{" "}
                    <span className="text-muted-foreground">
                      ({chosenDefs.length})
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {deviceModel} / {protocol}, field ที่บังคับถอดไม่ได้
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    role="group"
                    aria-label="โหมดแก้ไข"
                    className="flex rounded-lg border p-0.5"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={editorMode === "form" ? "secondary" : "ghost"}
                      aria-pressed={editorMode === "form"}
                      onClick={() => setEditorMode("form")}
                    >
                      <ListIcon />
                      ฟอร์ม
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={editorMode === "raw" ? "secondary" : "ghost"}
                      aria-pressed={editorMode === "raw"}
                      onClick={switchToRaw}
                    >
                      <CodeIcon />
                      JSON
                    </Button>
                  </div>
                  {isDirty && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setResetOpen(true)}
                    >
                      <RotateCcwIcon />
                      รีเซ็ต
                    </Button>
                  )}
                </div>
              </div>
              {editorMode === "raw" ? (
                <div className="grid gap-3 p-4 lg:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="config-raw">JSON ของ field และค่า</Label>
                    <textarea
                      id="config-raw"
                      value={rawText}
                      onChange={(e) => onRawChange(e.target.value)}
                      spellCheck={false}
                      rows={16}
                      aria-invalid={rawError ? true : undefined}
                      className="min-h-64 resize-y rounded-lg border border-input bg-transparent p-3 font-instrument text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
                    />
                    {rawError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {rawError}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        แก้แล้วซิงก์เข้าฟอร์มทันที ใช้ได้เฉพาะ field ที่มีในคลัง Parameter
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">ตัวอย่างที่ไฮไลต์</span>
                    <HighlightedJson text={rawText} />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4 p-4">
                  {chosenDefs.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      เลือก Parameter จากคลังด้านซ้ายมาเริ่มได้เลย
                    </p>
                  ) : (
                    groupedDefs.map(([category, defsInGroup]) => (
                      <section
                        key={category}
                        aria-label={category}
                        className="flex flex-col gap-2.5"
                      >
                        <h2 className="label-caps text-muted-foreground">
                          {category}{" "}
                          <span className="tabular-nums">
                            ({defsInGroup.length})
                          </span>
                        </h2>
                        {defsInGroup.map((def) => (
                          <TemplateRow
                            key={def.id}
                            def={def}
                            required={isRequiredHere(def)}
                            outsideSet={!isInModelSet(def)}
                            value={effectiveValue(def)}
                            missing={
                              missingRequired.includes(def.fieldName) ||
                              Boolean(fieldErrors[def.fieldName])
                            }
                            error={fieldErrors[def.fieldName] ?? null}
                            changed={changedNames.has(def.fieldName)}
                            originalValue={baseFields?.[def.fieldName]}
                            hasOriginal={
                              baseFields !== null &&
                              Object.hasOwn(baseFields, def.fieldName)
                            }
                            onChange={(v) => setValue(def.fieldName, v)}
                            onRemove={
                              isRequiredHere(def)
                                ? undefined
                                : () => removeField(def.fieldName)
                            }
                          />
                        ))}
                      </section>
                    ))
                  )}
                </div>
              )}
            </Card>
          </div>

          {diff && (
            <Card className="gap-3 p-4" aria-label="สิ่งที่จะเปลี่ยน">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {editing
                    ? "สิ่งที่จะเปลี่ยนจากฉบับที่บันทึกไว้"
                    : "สิ่งที่ต่างจาก Config ต้นฉบับ"}
                </p>
                <DiffCounts
                  counts={diff.counts}
                  unchangedCount={diff.unchangedCount}
                />
              </div>
              {diff.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  ยังไม่มีการเปลี่ยนแปลงจากฉบับเดิม
                </p>
              ) : (
                <DiffViewer
                  changes={diff.changes}
                  beforeLabel={editing ? "ฉบับที่บันทึกไว้" : "ต้นฉบับ"}
                  afterLabel="ฉบับที่กำลังแก้"
                  isMasked={(name) =>
                    (defs ?? []).find((d) => d.fieldName === name)?.sensitive ?? true
                  }
                  attention={(name) => {
                    const d = (defs ?? []).find((x) => x.fieldName === name);
                    if (!d) return null;
                    if (d.restartRequired) return "ต้อง Restart กล่องหลังเปลี่ยนค่านี้";
                    return d.sensitive ? "ค่าอ่อนไหว" : null;
                  }}
                />
              )}
            </Card>
          )}

          <ConfirmDialog
            open={resetOpen}
            onOpenChange={setResetOpen}
            title="รีเซ็ตการแก้ไขทั้งหมด?"
            description={
              source
                ? `ค่าทุกช่องจะกลับเป็นของ${editing ? "ฉบับที่บันทึกไว้" : "ต้นฉบับ"} การแก้ไขที่ทำไว้จะหายไป`
                : "Parameter ที่เลือกและค่าที่กรอกจะถูกล้างทั้งหมด"
            }
            confirmLabel="รีเซ็ต"
            destructive
            onConfirm={resetToInitial}
          />

          {formError && <ErrorBanner message={formError} list={formErrorList} />}

          <div className="sticky bottom-0 z-(--z-sticky) -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <p className="text-xs text-muted-foreground">
              {diff
                ? diff.changes.length > 0
                  ? `มีการเปลี่ยนแปลง ${diff.changes.length} ค่า ยังไม่ได้บันทึก`
                  : "ยังไม่ได้แก้ไขอะไร"
                : `เลือกไว้ ${chosenDefs.length} พารามิเตอร์`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  clearErrors();
                  setStep(1);
                }}
              >
                ← ย้อนกลับ
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || rawError !== null}>
                {submitting
                  ? "กำลังบันทึก…"
                  : editing
                    ? "บันทึกการแก้ไข"
                    : "บันทึก Config Draft"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CONFIG_WIZARD_STEPS = [
  { n: 1, label: "ข้อมูลพื้นฐาน" },
  { n: 2, label: "เลือก Parameter" },
] as const;

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

/** ป้ายบอกว่าพารามิเตอร์อยู่นอกชุดค่าเริ่มต้นของโมเดลนี้ (ใส่ได้ แต่ให้ผู้สร้าง
 * template รู้ตัวว่าไม่ใช่ชุดปกติของโมเดล) */
function OutsideSetBadge() {
  return (
    <span className="shrink-0 rounded-full border border-warning/30 bg-warning-subtle px-1.5 text-[0.65rem] whitespace-nowrap text-warning-foreground">
      นอกชุดของโมเดลนี้
    </span>
  );
}

function TemplateRow({
  def,
  required,
  outsideSet,
  value,
  missing,
  error,
  changed,
  originalValue,
  hasOriginal,
  onChange,
  onRemove,
}: {
  def: ConfigFieldDefinition;
  required: boolean;
  outsideSet: boolean;
  value: FieldValue | undefined;
  missing: boolean;
  /** ข้อความตรวจค่าแบบ real-time (Zod) · null = ผ่าน */
  error: string | null;
  /** ค่าต่างจากฉบับเดิม (โหมดแก้/โคลน) */
  changed: boolean;
  originalValue: unknown;
  hasOriginal: boolean;
  onChange: (value: FieldValue) => void;
  onRemove?: () => void;
}) {
  const id = `field-${def.fieldName}`;
  const hint = def.description ?? formatModelSupport(def.supportedModels);
  const errorId = `${id}-error`;
  const originalText =
    originalValue === undefined || originalValue === null
      ? "-"
      : typeof originalValue === "string"
        ? originalValue
        : JSON.stringify(originalValue);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3 transition-colors duration-(--duration-base) ease-(--ease-standard)",
        changed && "border-l-4 border-l-info bg-info-subtle/40",
        error && "border-destructive/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <Label htmlFor={id} className="font-instrument text-xs">
            {def.fieldName}
            {required ? <span className="text-destructive"> *</span> : null}
          </Label>
          {def.restartRequired && (
            <span className="rounded-full bg-warning-subtle px-1.5 text-[0.65rem] whitespace-nowrap text-warning-foreground">
              ต้อง Restart
            </span>
          )}
          {def.sensitive && (
            <span className="rounded-full bg-secondary px-1.5 text-[0.65rem] whitespace-nowrap text-secondary-foreground">
              อ่อนไหว
            </span>
          )}
          {changed && (
            <span className="rounded-full bg-info-subtle px-1.5 text-[0.65rem] whitespace-nowrap text-info-foreground">
              {hasOriginal ? "แก้ไขแล้ว" : "เพิ่มใหม่"}
            </span>
          )}
          {outsideSet && <OutsideSetBadge />}
        </span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`เอา ${def.fieldName} ออก`}
            className="rounded p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : (
          <span className="text-[0.65rem] text-muted-foreground">บังคับ</span>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {(def.defaultValue !== null && !def.sensitive) && (
        <p className="text-xs text-muted-foreground">
          ค่าเริ่มต้น <span className="font-instrument">{def.defaultValue}</span>
        </p>
      )}

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
          <Select
            value={typeof value === "string" ? value : ""}
            onValueChange={(v) => onChange(v ?? "")}
          >
            <SelectTrigger
              id={id}
              className="w-full"
              aria-invalid={missing ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            >
              <SelectValue placeholder="- เลือก -" />
            </SelectTrigger>
            <SelectContent>
              {def.allowedValues.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {def.unit && <UnitLabel unit={def.unit} />}
        </div>
      ) : def.sensitive ? (
        <div className="flex items-center gap-2">
          <SensitiveInput
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={missing ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {def.unit && <UnitLabel unit={def.unit} />}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type={isNumericDataType(def.dataType) ? "number" : "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={missing ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={isNumericDataType(def.dataType) ? "font-instrument" : undefined}
          />
          {def.unit && <UnitLabel unit={def.unit} />}
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {changed && hasOriginal && !def.sensitive && (
        <p className="text-xs text-muted-foreground">
          ค่าเดิม <span className="font-instrument">{originalText}</span>
        </p>
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
