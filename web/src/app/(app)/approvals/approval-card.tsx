"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { DiffCounts, DiffViewer } from "@/components/diff-viewer";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import { useConfigVersions } from "@/hooks/use-config-versions";
import type { PendingApproval } from "@/hooks/use-pending-approvals";
import { diffConfigFields, type ConfigDiff } from "@/lib/config-diff";
import { cn } from "@/lib/utils";
import { ApprovalActions } from "./approval-actions";
import { ApprovalQueueCard } from "./approval-queue-card";

/** ตารางเทียบค่าเดิม→ใหม่ ที่โหลดเมื่อกดขยายเท่านั้น (ต้องใช้คำจำกัดความ field
 * เพื่อปิดค่าอ่อนไหวและเตือนค่าที่ต้อง Restart) · ก่อนคำจำกัดความโหลดเสร็จ
 * ปิดค่าทุกตัวไว้ก่อน กัน plaintext หลุดช่วงสั้นๆ */
function DiffPreview({
  diff,
  baseLabel,
}: {
  diff: ConfigDiff;
  baseLabel: string;
}) {
  const definitions = useConfigDefinitions();
  const ready = !definitions.isLoading && definitions.data !== null;
  const metaByField = useMemo(
    () => new Map((definitions.data ?? []).map((d) => [d.fieldName, d])),
    [definitions.data],
  );
  const ordered = useMemo(() => {
    const attention = (name: string) => {
      const m = metaByField.get(name);
      return !!m && (m.sensitive || m.restartRequired);
    };
    return [...diff.changes].sort(
      (a, b) =>
        Number(attention(b.fieldName)) - Number(attention(a.fieldName)) ||
        a.fieldName.localeCompare(b.fieldName),
    );
  }, [diff.changes, metaByField]);
  const restartCount = ordered.filter(
    (c) => metaByField.get(c.fieldName)?.restartRequired,
  ).length;
  const sensitiveCount = ordered.filter(
    (c) => metaByField.get(c.fieldName)?.sensitive,
  ).length;

  return (
    <div className="flex flex-col gap-2">
      {(restartCount > 0 || sensitiveCount > 0) && (
        <p className="flex items-center gap-1.5 text-xs text-warning-foreground">
          <TriangleAlertIcon className="size-3.5" />
          {restartCount > 0 && `${restartCount} ค่าต้อง Restart กล่องหลังเปลี่ยน`}
          {restartCount > 0 && sensitiveCount > 0 && " · "}
          {sensitiveCount > 0 && `${sensitiveCount} ค่าอ่อนไหว`}
        </p>
      )}
      <DiffViewer
        changes={ordered}
        beforeLabel={baseLabel}
        afterLabel="ฉบับที่ขออนุมัติ"
        isMasked={(name) => !ready || (metaByField.get(name)?.sensitive ?? false)}
        attention={(name) => {
          const m = metaByField.get(name);
          if (!m) return null;
          if (m.restartRequired) return "ต้อง Restart กล่องหลังเปลี่ยนค่านี้";
          return m.sensitive ? "ค่าอ่อนไหว" : null;
        }}
      />
    </div>
  );
}

export function ApprovalCard({
  item,
  creatorName,
  canDecide,
  onDecided,
  selection,
}: {
  item: PendingApproval;
  /** ชื่อผู้สร้างที่ resolve แล้ว (หน้าคิว resolve ครั้งเดียวแล้วส่งลงมา กันยิง
   * GET /users ซ้ำต่อการ์ด) */
  creatorName: string;
  canDecide: boolean;
  onDecided: (action: "approve" | "reject") => void;
  /** เปิดกล่องเลือกสำหรับอนุมัติหลายรายการ · `disabledReason` = เลือกไม่ได้เพราะอะไร */
  selection?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabledReason?: string;
  };
}) {
  const versions = useConfigVersions(item.id);
  const [expanded, setExpanded] = useState(false);
  // เทียบกับเวอร์ชันที่อนุมัติล่าสุดเพื่อบอกจำนวนที่เปลี่ยนบนการ์ด · ยังโหลด
  // ไม่เสร็จหรือโหลดพลาดก็แค่ไม่โชว์ตัวเลข ไม่กระทบปุ่มอนุมัติ
  const latest = (versions.data ?? []).reduce<
    NonNullable<typeof versions.data>[number] | null
  >((best, v) => (best && best.versionNumber >= v.versionNumber ? best : v), null);
  const diff = useMemo(
    () => (latest ? diffConfigFields(latest.fields, item.fields) : null),
    [latest, item.fields],
  );

  const summary =
    versions.data === null ? (
      <span className="text-muted-foreground">
        {Object.keys(item.fields).length} ค่า
      </span>
    ) : diff && latest ? (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            เทียบกับเวอร์ชัน {latest.versionNumber}
          </span>
          <DiffCounts counts={diff.counts} />
          {diff.changes.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded text-xs text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {expanded ? "ซ่อนค่าที่เปลี่ยน" : "ดูค่าที่เปลี่ยน"}
              <ChevronDownIcon
                className={cn(
                  "size-3.5 transition-transform duration-(--duration-fast) ease-(--ease-standard)",
                  expanded && "rotate-180",
                )}
              />
            </button>
          )}
        </div>
        {expanded && (
          <DiffPreview
            diff={diff}
            baseLabel={`เวอร์ชันที่ ${latest.versionNumber}`}
          />
        )}
      </div>
    ) : (
      <span className="text-muted-foreground">
        ยังไม่เคยอนุมัติ (เวอร์ชันแรก) {Object.keys(item.fields).length} ค่า
      </span>
    );

  return (
    <ApprovalQueueCard
      tag="Config"
      title={item.name}
      meta={`${item.deviceModel} / ${item.protocol}`}
      queuedAt={item.queuedAt}
      detailHref={`/approvals/config/${item.id}`}
      description={item.description}
      requesterLabel="ผู้สร้าง"
      requesterName={creatorName}
      leading={
        selection && (
          <span title={selection.disabledReason}>
            <Checkbox
              checked={selection.checked}
              disabled={Boolean(selection.disabledReason)}
              onCheckedChange={(v) => selection.onChange(Boolean(v))}
              aria-label={`เลือก ${item.name}`}
            />
          </span>
        )
      }
      extra={
        item.suggestedApprover && (
          <span className="mt-1 inline-flex w-fit items-center rounded-full bg-info-subtle px-2 py-0.5 text-xs font-medium text-info-foreground">
            เจาะจงถึง: {item.suggestedApprover.fullName}
          </span>
        )
      }
      summary={summary}
      actions={
        <ApprovalActions
          configId={item.id}
          configName={item.name}
          canDecide={canDecide}
          onDecided={onDecided}
        />
      }
    />
  );
}
