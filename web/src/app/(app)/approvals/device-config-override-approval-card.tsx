"use client";

import { useMemo } from "react";

import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import type { DeviceConfigOverride } from "@/lib/device-config-override-api";
import { ConfigFieldLabel } from "@/components/config/config-field-label";
import { SensitiveValue } from "@/components/sensitive-value";
import { ApprovalQueueCard } from "./approval-queue-card";
import { DeviceConfigOverrideApprovalActions } from "./device-config-override-approval-actions";

function fieldValueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * คำขอ Per-device Config Override 1 รายการในคิว Approval Center (issue #223,
 * มติ 2026-09-24) — ค่าที่ขอแก้มักมีไม่กี่ค่า จึงแสดงรายการค่าไว้บนการ์ดใน
 * ส่วนสรุปด้วย (`fields` คือค่าสะสมของเครื่องนี้เอง ไม่ใช่ทั้งชุด Config)
 * พร้อมลิงก์ไปหน้ารายละเอียดเต็ม (แก้ครั้งที่ 94 — เครื่องจริงมีพารามิเตอร์
 * เยอะกว่านี้ กล่องเลื่อนเล็กๆ ไม่พอ)
 */
export function DeviceConfigOverrideApprovalCard({
  item,
  requesterName,
  canDecide,
  onDecided,
}: {
  item: DeviceConfigOverride;
  requesterName: string;
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
  const descriptionByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of definitions.data ?? []) {
      if (d.description) map.set(d.fieldName, d.description);
    }
    return map;
  }, [definitions.data]);
  /** ก่อน definitions โหลดเสร็จ treat ทุก field เป็น sensitive ไว้ก่อน — mirror
   * `config-approval-detail-view.tsx`/`config-detail-view.tsx` กัน plaintext หลุด */
  const effectiveSensitiveFieldNames = definitionsReady
    ? sensitiveFieldNames
    : new Set(Object.keys(item.fields));

  return (
    <ApprovalQueueCard
      tag="Config Override"
      title={<span className="font-mono">{item.deviceId}</span>}
      meta={`เวอร์ชัน #${item.versionNumber}`}
      queuedAt={item.overriddenAt}
      detailHref={`/approvals/config-override/${item.id}`}
      description={item.reason}
      requesterName={requesterName}
      summary={
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            ค่าที่ขอแก้ ({fieldEntries.length})
          </span>
          {fieldEntries.length === 0 ? (
            <span className="text-muted-foreground">ไม่มีพารามิเตอร์</span>
          ) : (
            <div className="max-h-48 divide-y overflow-y-auto rounded-lg border">
              {fieldEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-start justify-between gap-4 px-3 py-1.5"
                >
                  <ConfigFieldLabel
                    className="shrink-0"
                    fieldName={key}
                    description={descriptionByField.get(key)}
                  />
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
      }
      actions={
        <DeviceConfigOverrideApprovalActions
          id={item.id}
          deviceId={item.deviceId}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      }
    />
  );
}
