"use client";

import { SensitiveValue } from "@/components/sensitive-value";
import { Card } from "@/components/ui/card";
import type { CampaignRolloutTarget } from "@/lib/campaign-api";
import { valueToText } from "@/lib/rollout-device-values";

/**
 * ค่าเฉพาะเครื่องของ Rollout (docs/17) สำหรับผู้อนุมัติ — เครื่อง / field /
 * ค่าแม่แบบ / ค่าใหม่ พร้อมเหตุผล แสดงเฉพาะ Rollout ที่มีค่าเฉพาะเครื่อง
 *
 * ค่าอ่อนไหวมาถึงเป็น `********` สำหรับ role ที่ไม่ใช่ Operation อยู่แล้ว
 * (backend mask) ส่วน Operation เห็นค่าจริงผ่านปุ่มแสดง/ซ่อน
 */
export function RolloutDeviceValuesSummary({
  targets,
  templateFields,
  sensitiveFieldNames,
  reason,
}: {
  targets: CampaignRolloutTarget[];
  /** ค่าตั้งต้นของ Config แม่แบบ (null = ยังโหลดไม่ได้) */
  templateFields: Record<string, unknown> | null;
  sensitiveFieldNames: ReadonlySet<string>;
  reason: string | null | undefined;
}) {
  const rows = targets
    .filter((t) => t.proposedFields && Object.keys(t.proposedFields).length > 0)
    .flatMap((t) =>
      Object.entries(t.proposedFields ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fieldName, value]) => ({
          deviceId: t.deviceId,
          fieldName,
          value,
        })),
    );
  if (rows.length === 0) return null;

  const deviceCount = new Set(rows.map((r) => r.deviceId)).size;

  return (
    <Card className="gap-3 p-4">
      <div>
        <p className="text-sm font-medium">
          ค่าเฉพาะเครื่อง{" "}
          <span className="text-muted-foreground">({deviceCount} เครื่อง)</span>
        </p>
        <p className="text-xs text-muted-foreground">
          ค่าเหล่านี้ต่างจาก Config แม่แบบ จะมีผลเมื่อ Rollout ถูกปล่อยเข้าอุปกรณ์
        </p>
      </div>
      {reason && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">เหตุผล: </span>
          {reason}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden gap-3 border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,10rem)_minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]">
          <span>เครื่อง</span>
          <span>ชื่อฟิลด์</span>
          <span>ค่าแม่แบบ</span>
          <span>ค่าใหม่</span>
        </div>
        <div className="divide-y">
          {rows.map((r) => {
            const masked = sensitiveFieldNames.has(r.fieldName);
            const template = templateFields?.[r.fieldName];
            return (
              <div
                key={`${r.deviceId}:${r.fieldName}`}
                className="grid gap-1 px-3 py-2 text-xs sm:grid-cols-[minmax(0,10rem)_minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3"
              >
                <span className="font-mono">{r.deviceId}</span>
                <span className="font-mono text-muted-foreground">
                  {r.fieldName}
                </span>
                <span className="min-w-0 font-mono break-words text-muted-foreground">
                  {masked ? (
                    <SensitiveValue value={template} />
                  ) : templateFields === null ? (
                    "-"
                  ) : (
                    valueToText(template) || "-"
                  )}
                </span>
                <span className="min-w-0 font-mono break-words font-medium">
                  {masked ? (
                    <SensitiveValue value={r.value} />
                  ) : (
                    valueToText(r.value)
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
