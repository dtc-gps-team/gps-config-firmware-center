"use client";

import { useMemo } from "react";

import { ConfigFieldLabel } from "@/components/config/config-field-label";
import { useDescriptionByField } from "@/components/config/use-description-by-field";
import { SensitiveValue } from "@/components/sensitive-value";
import { useConfig } from "@/hooks/use-config";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { cn } from "@/lib/utils";

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * ค่าของ field ที่คำขอส่งเข้ากล่องจะส่ง อ่านจาก Config ต้นทาง (`GET /configs/{id}`)
 * เพราะ endpoint ของคำขอคืนแค่ชื่อ field · เป็นค่าปัจจุบันของ Config ไม่ใช่ snapshot
 * ตอนขอ (ตอนกดส่ง backend เช็คว่า Config ยังเป็นเวอร์ชันที่อนุมัติไว้) · field ที่
 * Override แก้ (`overriddenFields`) ไม่แสดงค่าของ Config แต่ชี้ไปส่วน Override แทน
 *
 * ก่อน definitions โหลดเสร็จ treat ทุก field เป็น sensitive ไว้ก่อน กัน plaintext
 * หลุดช่วงสั้นๆ (mirror override-field-diff-list.tsx)
 */
export function ConfigFieldValueList({
  configId,
  fieldNames,
  overriddenFields = [],
  className,
}: {
  configId: string;
  fieldNames: string[];
  overriddenFields?: string[];
  className?: string;
}) {
  const definitions = useConfigDefinitions();
  const { data: config, isLoading, error } = useConfig(configId);
  const descriptionByField = useDescriptionByField(definitions.data);
  const sensitiveFieldNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of definitions.data ?? []) {
      if (d.sensitive) set.add(d.fieldName);
    }
    return set;
  }, [definitions.data]);
  const isMasked = (name: string) =>
    definitions.isLoading || sensitiveFieldNames.has(name);
  const overridden = new Set(overriddenFields);
  const names = [...fieldNames].sort((a, b) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-1">
      {error && !config && (
        <p className="text-xs text-destructive">
          โหลดค่าจาก Config ไม่สำเร็จ แสดงเฉพาะชื่อ field
        </p>
      )}
      <div className={cn("divide-y rounded-lg border", className)}>
        {names.map((name) => {
          const value = config?.fields[name];
          return (
            <div
              key={name}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-1.5"
            >
              <ConfigFieldLabel
                className="min-w-0 max-w-[45%]"
                fieldName={name}
                description={descriptionByField.get(name)}
              />
              <span className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                {overridden.has(name) ? (
                  <span className="text-xs text-amber-600">
                    ใช้ค่าที่ช่างขอแก้ (ดูด้านล่าง)
                  </span>
                ) : isLoading && !config ? (
                  <span className="text-xs text-muted-foreground">กำลังโหลด</span>
                ) : !config ? null : isMasked(name) ? (
                  <SensitiveValue value={value} />
                ) : (
                  <span className="min-w-0 font-instrument break-words">
                    {valueText(value)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
