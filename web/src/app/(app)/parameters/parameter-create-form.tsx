"use client";

import { useMemo, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

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
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  createConfigDefinition,
  type ConfigFieldModelSupport,
} from "@/lib/config-definition-api";

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

/** ชนิดข้อมูลที่ backend `matchesDataType` รู้จัก (ค่าอื่นปล่อยผ่านเหมือนไม่มีนิยาม
 * — ดู config-definition.service.ts) จำกัดไว้ 3 ค่านี้เพื่อไม่ให้พิมพ์ผิด */
const DATA_TYPES = ["string", "number", "boolean"] as const;

function pairKey(m: ConfigFieldModelSupport): string {
  return `${m.deviceModel}/${m.protocol}`;
}

type Props = {
  /** คู่ (รุ่น/โปรโตคอล) ที่มีในระบบแล้ว — ให้เลือกเป็น checkbox */
  knownPairs: ConfigFieldModelSupport[];
  /** ชื่อ field ที่มีอยู่แล้ว (lowercase) — กันซ้ำตั้งแต่ฝั่ง client */
  existingNames: Set<string>;
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * ฟอร์มสร้าง Parameter (Config Field Definition) ใหม่ — `POST /config-definitions`
 * · SW เท่านั้น (gate ที่ปุ่มเปิดฟอร์มใน parameter-library-view.tsx +
 * PermissionGuard ฝั่ง backend) ตาม wireframe frame "คลัง Parameter"
 *
 * `supportedModels` เลือกจากคู่รุ่น/โปรโตคอลที่มีในระบบแล้วเท่านั้น (เคสปกติ
 * ทุก field ผูกกับรุ่นเดิม) — ถ้าต้องรองรับรุ่นใหม่ที่ยังไม่เคยมี field เลย
 * ค่อยเพิ่ม flow กรอกเองทีหลัง
 */
export function ParameterCreateForm({
  knownPairs,
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
  const [unit, setUnit] = useState("");
  const [allowedValues, setAllowedValues] = useState<string[]>([]);
  const [optionDraft, setOptionDraft] = useState("");
  const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set());

  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorList, setFormErrorList] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const dedupedPairs = useMemo(() => {
    const seen = new Set<string>();
    const out: ConfigFieldModelSupport[] = [];
    for (const m of knownPairs) {
      const k = pairKey(m);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
    return out.sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
  }, [knownPairs]);

  function clearErrors() {
    setNameError(null);
    setFormError(null);
    setFormErrorList([]);
  }

  function togglePair(key: string) {
    clearErrors();
    setSelectedPairs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
    if (selectedPairs.size === 0) {
      setFormError("เลือกรุ่น/โปรโตคอลที่รองรับอย่างน้อย 1 คู่");
      return;
    }
    if (unit.trim().length > 20) {
      setFormError("หน่วยยาวเกิน 20 ตัวอักษร");
      return;
    }

    const supportedModels = dedupedPairs.filter((m) =>
      selectedPairs.has(pairKey(m)),
    );
    const trimmedDesc = description.trim();
    const trimmedUnit = unit.trim();

    setSubmitting(true);
    try {
      await createConfigDefinition(token, {
        fieldName: trimmedName,
        dataType,
        required,
        ...(unknownSpec ? { unknownSpec: true } : {}),
        ...(allowedValues.length ? { allowedValues } : {}),
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
        ...(trimmedUnit ? { unit: trimmedUnit } : {}),
        supportedModels: supportedModels.map((m) => ({
          deviceModel: m.deviceModel,
          protocol: m.protocol,
        })),
      });
      await onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setNameError(err.message);
      } else if (err instanceof ApiError) {
        setFormError(err.message);
        setFormErrorList(err.details ?? []);
      } else {
        setFormError("สร้าง Parameter ไม่สำเร็จ");
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
              <select
                id="param-datatype"
                value={dataType}
                onChange={(e) => setDataType(e.target.value)}
                className={SELECT_CLASS}
              >
                {DATA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
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
            <legend className="text-sm font-medium">
              รุ่น/โปรโตคอลที่รองรับ
            </legend>
            {dedupedPairs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                ยังไม่มีรุ่น/โปรโตคอลในระบบ — สร้าง Config อย่างน้อย 1 ชุดก่อน
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {dedupedPairs.map((m) => {
                  const key = pairKey(m);
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm"
                      htmlFor={`param-pair-${key}`}
                    >
                      <Checkbox
                        id={`param-pair-${key}`}
                        checked={selectedPairs.has(key)}
                        onCheckedChange={() => togglePair(key)}
                      />
                      <span className="font-mono">{key}</span>
                    </label>
                  );
                })}
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
