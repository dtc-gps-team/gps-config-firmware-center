"use client";

import { DiffCounts, DiffViewer } from "@/components/diff-viewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Firmware } from "@/lib/firmware-api";
import { compareFirmware } from "@/lib/firmware-compare";
import { compareVersions } from "@/lib/firmware-staleness";

/** เทียบ Firmware 2 เวอร์ชัน: ตัวเก่ากว่า (เลขเวอร์ชันต่ำกว่า) อยู่ซ้าย ตัวใหม่อยู่ขวา */
export function FirmwareCompareDialog({
  pair,
  onClose,
}: {
  pair: [Firmware, Firmware] | null;
  onClose: () => void;
}) {
  const [older, newer] = pair
    ? compareVersions(pair[0].version, pair[1].version) <= 0
      ? pair
      : [pair[1], pair[0]]
    : [null, null];
  const diff = older && newer ? compareFirmware(older, newer) : null;

  return (
    <Dialog open={pair !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>เปรียบเทียบเวอร์ชัน Firmware</DialogTitle>
          <DialogDescription>
            {older && newer && (
              <>
                <span className="font-instrument">{older.version}</span> เทียบกับ{" "}
                <span className="font-instrument">{newer.version}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {older && newer && diff && (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            <DiffCounts counts={diff.counts} unchangedCount={diff.unchangedCount} />
            {diff.changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                สองเวอร์ชันนี้มีค่าเหมือนกันทุกด้านที่เปรียบเทียบ
              </p>
            ) : (
              <DiffViewer
                changes={diff.changes}
                beforeLabel={older.version}
                afterLabel={newer.version}
                showKind={false}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
