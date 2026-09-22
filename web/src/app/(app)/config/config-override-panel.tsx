"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { overrideConfig, type Config } from "@/lib/config-api";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";
import { canOverrideConfig } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const OVERRIDABLE_STATUSES = new Set(["approved", "synced"]);

/** parse ค่าจาก input (string เสมอ) กลับเป็นชนิดข้อมูลตาม dataType ของ field —
 * ตรงกับ `matchesDataType` ฝั่ง backend (config-definition.service.ts) */
function parseByDataType(raw: string, dataType: string): unknown {
  if (dataType === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (dataType === "boolean") {
    return raw === "true";
  }
  return raw;
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Per-Field Config Override (issue #185, Phase 1) — เฉพาะ role ST เท่านั้น
 * (ไม่ใช่แค่ disable — OT ไม่เห็น panel นี้เลย เพราะไม่มีสิทธิ์อะไรกับ
 * ฟีเจอร์นี้แม้แต่ฟิลด์เดียว ต่างจาก field ที่ `stOverridable: false` ที่ ST
 * เองก็ยังเห็นแต่แก้ไม่ได้ — ดู `canOverrideConfig`)
 *
 * โผล่เฉพาะ Config สถานะ `approved`/`synced` (`OVERRIDABLE_CONFIG_STATUSES`
 * ฝั่ง backend) — override ระหว่างยังร่าง/ทดสอบไม่มีความหมาย (ConfigEngineer
 * แก้ตรงๆ ผ่าน `update()` ปกติได้อยู่แล้วตอนนั้น)
 */
export function ConfigOverridePanel({
  config,
  onOverridden,
}: {
  config: Config;
  onOverridden: () => void;
}) {
  const { session } = useAuth();
  const definitions = useConfigDefinitions();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<string[]>([]);

  const defByName = useMemo(() => {
    const map = new Map<string, ConfigFieldDefinition>();
    for (const d of definitions.data ?? []) map.set(d.fieldName, d);
    return map;
  }, [definitions.data]);

  if (!canOverrideConfig(session?.role)) {
    return null;
  }

  if (!OVERRIDABLE_STATUSES.has(config.status)) {
    return null;
  }

  const fieldEntries = Object.entries(config.fields);

  function currentInputValue(key: string, original: unknown): string {
    return edits[key] ?? toInputValue(original);
  }

  function setEdit(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.accessToken || submitting) return;
    setError(null);
    setErrorList([]);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("กรอกเหตุผลก่อน override");
      return;
    }

    // ส่งเฉพาะ field ที่ค่าเปลี่ยนจริงจากที่แสดงอยู่เดิม — override เป็น
    // partial update ไม่ต้องส่งทั้งชุด (ตรงกับ OverrideConfigDto ฝั่ง backend)
    const changed: Record<string, unknown> = {};
    for (const [key, original] of fieldEntries) {
      const def = defByName.get(key);
      if (!def?.stOverridable) continue;
      const rawEdit = edits[key];
      if (rawEdit === undefined) continue;
      if (rawEdit === toInputValue(original)) continue;
      changed[key] = parseByDataType(rawEdit, def.dataType);
    }

    if (Object.keys(changed).length === 0) {
      setError("ยังไม่ได้แก้ค่าไหนเลย");
      return;
    }

    setSubmitting(true);
    try {
      await overrideConfig(session.accessToken, config.id, {
        fields: changed,
        reason: trimmedReason,
      });
      toast.success("Override สำเร็จ — ค่าถูกเปลี่ยนแล้ว");
      setEdits({});
      setReason("");
      onOverridden();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setErrorList(err.details ?? []);
        toast.error(err.message);
      } else {
        setError("Override ไม่สำเร็จ");
        toast.error("Override ไม่สำเร็จ");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <div>
        <p className="text-sm font-medium">Override ค่าพารามิเตอร์ (ST)</p>
        <p className="text-sm text-muted-foreground">
          แก้ค่าที่ตั้งใน Parameter Library ว่า &ldquo;ST override
          ได้&rdquo; เท่านั้น — ข้ามขั้นตอนอนุมัติปกติ ต้องระบุเหตุผลทุกครั้ง
          และถูกบันทึกลง Audit Log แบบไม่มีข้อยกเว้น
        </p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <div className="divide-y rounded-lg border bg-card">
          {fieldEntries.map(([key, original]) => {
            const def = defByName.get(key);

            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <Label
                  htmlFor={`override-${key}`}
                  className="shrink-0 font-mono text-xs text-muted-foreground"
                >
                  {key}
                </Label>
                {!def?.stOverridable ? (
                  <span
                    className="min-w-0 truncate font-mono text-xs text-muted-foreground"
                    title="field นี้ override ไม่ได้ — ยังไม่ได้เปิดไว้ใน Parameter Library"
                  >
                    {toInputValue(original)}{" "}
                    <span className="text-muted-foreground/70">
                      (override ไม่ได้)
                    </span>
                  </span>
                ) : def.dataType === "boolean" ? (
                  <Select
                    value={currentInputValue(key, original)}
                    onValueChange={(v) => v && setEdit(key, v)}
                  >
                    <SelectTrigger id={`override-${key}`} className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                  </Select>
                ) : def.allowedValues.length > 0 ? (
                  <Select
                    value={currentInputValue(key, original)}
                    onValueChange={(v) => v && setEdit(key, v)}
                  >
                    <SelectTrigger id={`override-${key}`} className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {def.allowedValues.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`override-${key}`}
                    className="h-8 w-40 font-mono text-xs"
                    type={def.dataType === "number" ? "number" : "text"}
                    value={currentInputValue(key, original)}
                    onChange={(e) => setEdit(key, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="override-reason">เหตุผล (บังคับ)</Label>
          <Input
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น ลูกค้าขอเปลี่ยนค่าหน้างาน / แก้ไขข้อผิดพลาดที่พบ"
            maxLength={500}
          />
        </div>

        {error && (
          <div className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span>{error}</span>
            {errorList.length > 0 && (
              <ul className="list-disc pl-5 text-xs">
                {errorList.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? "กำลังบันทึก…" : "ยืนยัน Override"}
          </Button>
        </div>
      </form>
    </div>
  );
}
