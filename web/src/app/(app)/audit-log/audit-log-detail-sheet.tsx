"use client";

import { CopyButton } from "@/components/copy-button";
import { InfoRow } from "@/components/info-row";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AuditLogRow } from "@/hooks/use-audit-logs";

function MetadataValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap justify-end gap-1">
        {value.map((item, i) => (
          <span
            key={i}
            className="font-instrument rounded-sm bg-secondary px-1.5 py-0.5 text-xs"
          >
            {String(item)}
          </span>
        ))}
      </span>
    );
  }
  const text =
    value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return <span className="font-instrument text-xs break-all">{text}</span>;
}

/**
 * รายละเอียด 1 แถว Audit Log แบบ drawer ด้านขวา: ผู้ทำ โมดูล action เวลา IP และ
 * `metadata` ที่ backend บันทึกไว้ (ตอนนี้มีเฉพาะ `apply-config`) · API ไม่เก็บค่า
 * ก่อน/หลังการแก้ไข จึงไม่มีมุมมอง diff ของค่า เก็บแค่ชื่อ field ที่ถูกเปลี่ยน
 */
export function AuditLogDetailSheet({
  row,
  onClose,
}: {
  row: AuditLogRow | null;
  onClose: () => void;
}) {
  const metadata = row?.metadata ? Object.entries(row.metadata) : [];

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>
                <span className="font-instrument">{row.action}</span>
              </SheetTitle>
              <SheetDescription>
                {new Date(row.createdAt).toLocaleString("th-TH")}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <div className="divide-y">
                <InfoRow label="ผู้ทำรายการ">{row.actorName}</InfoRow>
                <InfoRow label="โมดูล">
                  <span className="font-instrument text-xs">
                    {row.auditModule}
                  </span>
                </InfoRow>
                <InfoRow label="IP Address">
                  <span className="font-instrument text-xs">
                    {row.ipAddress ?? "-"}
                  </span>
                </InfoRow>
                <InfoRow label="รหัสรายการ">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-instrument text-xs">
                      {row.id.slice(0, 8)}
                    </span>
                    <CopyButton value={row.id} label="คัดลอกรหัสรายการ" />
                  </span>
                </InfoRow>
              </div>

              <div className="flex flex-col gap-2">
                <p className="label-caps text-muted-foreground">รายละเอียดที่บันทึก</p>
                {metadata.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    action นี้ไม่มีรายละเอียดเพิ่มเติมที่บันทึกไว้
                  </p>
                ) : (
                  <div className="divide-y rounded-md border px-3">
                    {metadata.map(([key, value]) => (
                      <InfoRow key={key} label={key}>
                        <MetadataValue value={value} />
                      </InfoRow>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
