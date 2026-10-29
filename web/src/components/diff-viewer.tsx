import { TriangleAlertIcon } from "lucide-react";

import { SensitiveValue } from "@/components/sensitive-value";
import type { FieldChange, FieldChangeKind } from "@/lib/config-diff";
import { cn } from "@/lib/utils";

const CHANGE_LABEL: Record<FieldChangeKind, string> = {
  added: "เพิ่ม",
  changed: "แก้ไข",
  removed: "ลบ",
};

const GRID =
  "sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)_4rem]";

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function ValueCell({ value, masked }: { value: unknown; masked: boolean }) {
  if (masked) return <SensitiveValue value={value} />;
  return (
    <span className="min-w-0 font-instrument text-xs break-words">
      {valueText(value)}
    </span>
  );
}

/** ตัวเลขสรุปจำนวน เพิ่ม / แก้ไข / ลบ / ไม่เปลี่ยน */
export function DiffCounts({
  counts,
  unchangedCount,
}: {
  counts: Record<FieldChangeKind, number>;
  unchangedCount?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-xs tabular-nums">
      <span className="rounded-full bg-success-subtle px-2 py-0.5 text-success-foreground">
        เพิ่ม {counts.added}
      </span>
      <span className="rounded-full bg-info-subtle px-2 py-0.5 text-info-foreground">
        แก้ไข {counts.changed}
      </span>
      <span className="rounded-full bg-danger-subtle px-2 py-0.5 text-danger-foreground">
        ลบ {counts.removed}
      </span>
      {unchangedCount !== undefined && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          ไม่เปลี่ยน {unchangedCount}
        </span>
      )}
    </div>
  );
}

/**
 * ตารางเทียบค่าเดิม → ค่าใหม่ ต่อ field (ใช้ `diffConfigFields` สร้างรายการ)
 * - ค่าเดิมพื้นแดงอ่อน ค่าใหม่พื้นเขียวอ่อน และมีป้ายประเภท (เพิ่ม/แก้ไข/ลบ)
 *   จึงไม่พึ่งสีอย่างเดียว
 * - `isMasked` = ปิดค่าอ่อนไหว · `attention` = ข้อความเตือนต่อ field (ถ้ามี)
 * - จอแคบจัดเป็นบล็อกต่อ field แทนคอลัมน์
 */
export function DiffViewer({
  changes,
  beforeLabel,
  afterLabel,
  isMasked = () => false,
  attention = () => null,
  className,
}: {
  changes: FieldChange[];
  beforeLabel: string;
  afterLabel: string;
  isMasked?: (fieldName: string) => boolean;
  attention?: (fieldName: string) => string | null;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border", className)}>
      <div
        className={cn(
          "hidden gap-3 border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:grid",
          GRID,
        )}
        role="row"
      >
        <span>ชื่อฟิลด์</span>
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
        <span>ประเภท</span>
      </div>
      <div className="divide-y">
        {changes.map((c) => {
          const warn = attention(c.fieldName);
          return (
            <div
              key={c.fieldName}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)] gap-1 px-3 py-2 text-xs sm:items-start sm:gap-3",
                GRID,
              )}
            >
              <span className="flex items-center gap-1 font-instrument text-muted-foreground">
                {c.fieldName}
                {warn && (
                  <span title={warn}>
                    <TriangleAlertIcon
                      className="size-3.5 text-warning"
                      aria-label={warn}
                    />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 rounded px-1.5 py-0.5",
                  c.kind === "added"
                    ? "text-muted-foreground"
                    : "bg-danger-subtle",
                )}
              >
                <span className="text-muted-foreground sm:hidden">
                  {beforeLabel}:{" "}
                </span>
                {c.kind === "added" ? (
                  "-"
                ) : (
                  <ValueCell value={c.before} masked={isMasked(c.fieldName)} />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 rounded px-1.5 py-0.5",
                  c.kind === "removed"
                    ? "text-muted-foreground"
                    : "bg-success-subtle",
                )}
              >
                <span className="text-muted-foreground sm:hidden">
                  {afterLabel}:{" "}
                </span>
                {c.kind === "removed" ? (
                  "-"
                ) : (
                  <ValueCell value={c.after} masked={isMasked(c.fieldName)} />
                )}
              </span>
              <span className="font-medium">{CHANGE_LABEL[c.kind]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
