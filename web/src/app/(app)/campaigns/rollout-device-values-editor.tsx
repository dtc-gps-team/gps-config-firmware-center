"use client";

import { useMemo, useState } from "react";

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
import { SensitiveInput } from "@/components/sensitive-value";
import type { Config } from "@/lib/config-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";
import { isSameValue } from "@/lib/config-diff";
import { parseFieldInput, valueToText } from "@/lib/rollout-device-values";

const MASK = "********";

/**
 * แผงแก้ค่า Config เฉพาะเครื่องของ 1 เครื่อง (docs/17 ข้อ 3.8) — แสดง
 * พารามิเตอร์ของ Config แม่แบบ พร้อมค่าตั้งต้น ช่องกรอกค่าเฉพาะเครื่อง
 * ตรวจชนิดข้อมูลทันที และปุ่มคืนค่าทีละช่อง
 *
 * ค่าที่เท่ากับค่าที่เครื่องจะได้อยู่แล้ว (แม่แบบ หรือค่าพิเศษเดิมที่ยืนยันให้
 * ใช้ต่อ) ไม่นับเป็นการแก้ · แสดงเฉพาะ field ที่อยู่ใน Config แม่แบบ
 * (ค่านอก Config ยังไม่รองรับในรอบนี้)
 */
export function RolloutDeviceValuesEditor({
  open,
  onOpenChange,
  deviceId,
  config,
  definitions,
  baseFields,
  edits,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  config: Config;
  definitions: ConfigFieldDefinition[];
  /** ค่าพิเศษเดิมที่ผู้ใช้ยืนยันให้ใช้ต่อ (ว่างถ้าไม่มี/เลือกใช้ตามแม่แบบ) */
  baseFields: Record<string, unknown>;
  /** ค่าที่แก้ไว้แล้วของเครื่องนี้ (แปลงชนิดแล้ว) */
  edits: Record<string, unknown>;
  onSave: (edits: Record<string, unknown>) => void;
}) {
  // เปิดใหม่ทุกครั้งเริ่มจากค่าที่บันทึกไว้ — ใช้ key ที่ผู้เรียก (mount เมื่อเปิด)
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(edits).map(([name, value]) => [name, valueToText(value)]),
    ),
  );
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const defByName = useMemo(
    () => new Map(definitions.map((d) => [d.fieldName, d])),
    [definitions],
  );
  const fieldNames = useMemo(() => {
    const term = search.trim().toLowerCase();
    return Object.keys(config.fields)
      .sort()
      .filter((n) => !term || n.toLowerCase().includes(term));
  }, [config.fields, search]);

  const editedCount = Object.values(drafts).filter((v) => v.trim() !== "")
    .length;

  function setDraft(name: string, value: string) {
    setDrafts((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function handleSave() {
    const nextEdits: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};

    for (const [name, raw] of Object.entries(drafts)) {
      if (raw.trim() === "") continue;
      const def = defByName.get(name);
      const parsed = parseFieldInput(
        def ?? { dataType: "string", allowedValues: [] },
        raw,
      );
      if (!parsed.ok) {
        nextErrors[name] = parsed.error;
        continue;
      }
      const effective = Object.hasOwn(baseFields, name)
        ? baseFields[name]
        : config.fields[name];
      if (isSameValue(parsed.value, effective)) continue;
      nextEdits[name] = parsed.value;
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    onSave(nextEdits);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ค่าเฉพาะเครื่อง {deviceId}</DialogTitle>
          <DialogDescription>
            เครื่องนี้ใช้ค่าตาม Config {config.name} ยกเว้นช่องที่กรอกไว้
            ค่าจะมีผลเมื่อ Rollout ผ่านการอนุมัติและถูกปล่อยเข้าอุปกรณ์
          </DialogDescription>
        </DialogHeader>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาพารามิเตอร์"
          aria-label="ค้นหาพารามิเตอร์"
          className="h-8"
        />

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
          {fieldNames.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              ไม่พบพารามิเตอร์ที่ตรงกับคำค้น
            </p>
          ) : (
            <ul className="divide-y">
              {fieldNames.map((name) => {
                const def = defByName.get(name);
                const sensitive = def?.sensitive ?? false;
                const hasBase = Object.hasOwn(baseFields, name);
                const shown = hasBase ? baseFields[name] : config.fields[name];
                const draft = drafts[name] ?? "";
                const error = errors[name];
                return (
                  <li
                    key={name}
                    className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor={`dv-${name}`}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {name}
                      </label>
                      <span className="text-xs text-muted-foreground">
                        {hasBase ? "ค่าพิเศษเดิม" : "แม่แบบ"}{" "}
                        <span className="font-mono">
                          {sensitive ? MASK : valueToText(shown)}
                        </span>
                        {def?.unit ? ` ${def.unit}` : ""}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {sensitive ? (
                          <SensitiveInput
                            id={`dv-${name}`}
                            value={draft}
                            onChange={(e) => setDraft(name, e.target.value)}
                            placeholder="ไม่แก้"
                            className="h-8"
                          />
                        ) : (
                          <Input
                            id={`dv-${name}`}
                            value={draft}
                            onChange={(e) => setDraft(name, e.target.value)}
                            placeholder="ไม่แก้"
                            className="h-8"
                            aria-invalid={error ? true : undefined}
                          />
                        )}
                        {draft !== "" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDraft(name, "")}
                            aria-label={`คืนค่า ${name}`}
                          >
                            คืนค่า
                          </Button>
                        )}
                      </div>
                      {error && (
                        <p className="text-xs text-destructive">{error}</p>
                      )}
                      {def && def.allowedValues.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          ค่าที่ยอมรับ: {def.allowedValues.join(", ")}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={editedCount === 0}
            onClick={() => {
              setDrafts({});
              setErrors({});
            }}
          >
            รีเซ็ตทั้งหมด
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleSave}>
              บันทึกค่าของเครื่องนี้
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
