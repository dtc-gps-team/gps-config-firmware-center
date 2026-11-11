"use client";

import { useMemo } from "react";
import { ArrowRightIcon } from "lucide-react";

import { ConfigFieldLabel } from "@/components/config/config-field-label";
import { useDescriptionByField } from "@/components/config/use-description-by-field";
import { SensitiveValue } from "@/components/sensitive-value";
import { useConfig } from "@/hooks/use-config";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { cn } from "@/lib/utils";

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * รายการค่าที่ขอแก้ของคำขอ Override จากโมบาย แสดง "ค่าเดิม → ค่าที่ขอ" ต่อ
 * พารามิเตอร์ (ฟีดแบ็กพี่เลี้ยง: อยากเห็นว่าแก้ค่าอะไร จากอะไรเป็นอะไร) · ค่าเดิม
 * = ค่าของพารามิเตอร์นั้นใน Config ต้นทาง (`configId`) · ยังโหลด Config ไม่เสร็จ
 * หรือโหลดไม่ได้ จะแสดงเฉพาะค่าที่ขอเหมือนเดิม ไม่บล็อกการอนุมัติ
 *
 * ซ่อนทุกค่าไว้ก่อนจนกว่าจะได้ definitions จริง ทั้งช่วงที่ยังโหลด และตอนโหลด
 * ไม่สำเร็จ (fail-closed แบบเดียวกับ config-approval-detail-view.tsx) role ที่ไม่มี
 * สิทธิ์ `config-definition:Read` จะได้ 403 ถ้าเช็คแค่ `isLoading` ค่าลับจะโชว์
 * เป็นตัวอักษรจริง (รีวิว B บน PR #469)
 */
export function OverrideFieldDiffList({
  configId,
  fields,
  className,
}: {
  configId: string;
  fields: Record<string, unknown>;
  className?: string;
}) {
  const definitions = useConfigDefinitions();
  const { data: config } = useConfig(configId);
  const descriptionByField = useDescriptionByField(definitions.data);
  const sensitiveFieldNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of definitions.data ?? []) {
      if (d.sensitive) set.add(d.fieldName);
    }
    return set;
  }, [definitions.data]);
  const definitionsReady = !definitions.isLoading && definitions.data !== null;
  const isMasked = (name: string) =>
    !definitionsReady || sensitiveFieldNames.has(name);

  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));

  function renderValue(name: string, value: unknown, muted = false) {
    return isMasked(name) ? (
      <SensitiveValue value={value} />
    ) : (
      <span
        className={cn(
          "min-w-0 font-instrument break-words",
          muted && "text-muted-foreground line-through",
        )}
      >
        {valueText(value)}
      </span>
    );
  }

  return (
    <div className={cn("divide-y rounded-lg border", className)}>
      {entries.map(([name, value]) => {
        const hasOriginal = config !== null && name in config.fields;
        const original = hasOriginal ? config.fields[name] : undefined;
        const unchanged = hasOriginal && sameValue(original, value);
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
              {config !== null &&
                (hasOriginal ? (
                  !unchanged && renderValue(name, original, true)
                ) : (
                  <span className="text-xs text-muted-foreground">
                    ไม่มีใน Config
                  </span>
                ))}
              {config !== null && !unchanged && (
                <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              {renderValue(name, value)}
              {unchanged && (
                <span className="text-xs text-muted-foreground">
                  (ค่าเดิม ไม่เปลี่ยน)
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
