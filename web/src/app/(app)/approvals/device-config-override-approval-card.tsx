"use client";

import { useMemo } from "react";

import { formatDateTime } from "@/lib/format-date";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import type { DeviceConfigOverride } from "@/lib/device-config-override-api";
import { SensitiveValue } from "@/components/sensitive-value";
import { DeviceConfigOverrideApprovalActions } from "./device-config-override-approval-actions";

function fieldValueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * คำขอ Per-device Config Override 1 รายการในคิว Approval Center (issue #223,
 * มติ 2026-09-24) — mirror `approval-card.tsx` แต่ตัดส่วน re-simulate/version
 * history ออก เพราะ override รายเครื่องไม่มี concept นั้น (`fields` คือค่า
 * สะสมของอุปกรณ์เครื่องนี้เอง ไม่ใช่ทั้งชุด Config)
 */
export function DeviceConfigOverrideApprovalCard({
  item,
  canDecide,
  onDecided,
}: {
  item: DeviceConfigOverride;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
}) {
  const definitions = useConfigDefinitions();
  const fieldEntries = Object.entries(item.fields);
  const definitionsReady = !definitions.isLoading;
  const sensitiveFieldNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of definitions.data ?? []) {
      if (d.sensitive) set.add(d.fieldName);
    }
    return set;
  }, [definitions.data]);
  /** ก่อน definitions โหลดเสร็จ treat ทุก field เป็น sensitive ไว้ก่อน — mirror
   * `approval-card.tsx`/`config-detail-view.tsx` กัน plaintext หลุดช่วงสั้นๆ */
  const effectiveSensitiveFieldNames = definitionsReady
    ? sensitiveFieldNames
    : new Set(Object.keys(item.fields));

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{item.deviceId}</span>
            <span className="text-xs text-muted-foreground">
              เวอร์ชัน #{item.versionNumber}
            </span>
          </div>
          <p className="text-sm">{item.reason}</p>
          <p className="text-xs text-muted-foreground">
            ผู้ส่งคำขอ (ST) <span className="font-mono">{item.overriddenBy}</span>{" "}
            · ส่งเมื่อ {formatDateTime(item.overriddenAt)}
          </p>
        </div>
        <DeviceConfigOverrideApprovalActions
          id={item.id}
          deviceId={item.deviceId}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      </div>

      <div className="border-t px-4 py-3">
        <p className="mb-2 text-sm text-muted-foreground">
          ค่าที่ขอ override ({fieldEntries.length})
        </p>
        {fieldEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">ไม่มีพารามิเตอร์</p>
        ) : (
          <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            {fieldEntries.map(([key, value]) => (
              <div
                key={key}
                className="flex justify-between gap-4 px-3 py-1.5 text-xs"
              >
                <span className="shrink-0 font-mono text-muted-foreground">
                  {key}
                </span>
                {effectiveSensitiveFieldNames.has(key) ? (
                  <SensitiveValue value={value} />
                ) : (
                  <span className="min-w-0 font-mono break-words">
                    {fieldValueText(value)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
