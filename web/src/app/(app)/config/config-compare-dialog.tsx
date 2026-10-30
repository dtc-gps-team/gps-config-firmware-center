"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRightIcon } from "lucide-react";

import { DiffCounts, DiffViewer } from "@/components/diff-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { useConfigDefinitions } from "@/hooks/use-config-definitions";
import type { Config } from "@/lib/config-api";
import { diffConfigFields } from "@/lib/config-diff";

/**
 * เทียบ Config 2 ชุด (เช่น แม่แบบมาตรฐานกับ Config ที่แก้เฉพาะงาน): ซ้าย = ฐานเปรียบเทียบ
 * ขวา = ตัวที่ดูว่าต่างจากฐานอย่างไร · สลับด้านได้ · ค่า sensitive ถูกปิดไว้เสมอ (ก่อนรู้ว่า
 * field ไหน sensitive หรืออ่านรายการนิยามไม่ได้ ปิดทุกค่า — safe default เหมือนหน้ารายละเอียด Config)
 */
export function ConfigCompareDialog({
  pair,
  onClose,
}: {
  pair: [Config, Config] | null;
  onClose: () => void;
}) {
  const [swapped, setSwapped] = useState(false);
  const definitions = useConfigDefinitions();

  const sensitive = useMemo(() => {
    const set = new Set<string>();
    for (const d of definitions.data ?? []) {
      if (d.sensitive) set.add(d.fieldName);
    }
    return set;
  }, [definitions.data]);
  const definitionsKnown = definitions.data !== null;

  const [base, other] = pair
    ? swapped
      ? [pair[1], pair[0]]
      : pair
    : [null, null];
  const diff = useMemo(
    () => (base && other ? diffConfigFields(base.fields, other.fields) : null),
    [base, other],
  );

  return (
    <Dialog
      open={pair !== null}
      onOpenChange={(open) => {
        if (!open) {
          setSwapped(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>เปรียบเทียบ Config</DialogTitle>
          <DialogDescription>
            {base && other && (
              <>
                {other.name} เทียบกับ {base.name} (ฐาน)
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {base && other && diff && (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DiffCounts
                counts={diff.counts}
                unchangedCount={diff.unchangedCount}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSwapped((v) => !v)}
              >
                <ArrowLeftRightIcon />
                สลับด้าน
              </Button>
            </div>
            {(base.deviceModel !== other.deviceModel ||
              base.protocol !== other.protocol) && (
              <Notice tone="warning">
                สอง Config เป็นคนละโมเดลหรือโปรโตคอล ({base.deviceModel} /{" "}
                {base.protocol} กับ {other.deviceModel} / {other.protocol})
                ฟิลด์ที่มีเฉพาะฝั่งเดียวจะขึ้นเป็น เพิ่ม หรือ ลบ
              </Notice>
            )}
            {diff.changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                สอง Config นี้มีค่าเหมือนกันทุกฟิลด์
              </p>
            ) : (
              <DiffViewer
                changes={diff.changes}
                beforeLabel={base.name}
                afterLabel={other.name}
                isMasked={(name) => !definitionsKnown || sensitive.has(name)}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
