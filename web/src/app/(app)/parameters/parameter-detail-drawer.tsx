"use client";

import { CopyButton } from "@/components/copy-button";
import { InfoRow } from "@/components/info-row";
import { SensitiveValue } from "@/components/sensitive-value";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

function Flag({
  tone,
  children,
}: {
  tone: "warning" | "neutral" | "info";
  children: React.ReactNode;
}) {
  const cls = {
    warning: "bg-warning-subtle text-warning-foreground",
    info: "bg-info-subtle text-info-foreground",
    neutral: "bg-secondary text-secondary-foreground/80",
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

/** ค่าเริ่มต้นเป็น JSON snippet พร้อมวางลงไฟล์ Config (ชนิดตัวเลข/boolean ไม่ใส่เครื่องหมายคำพูด) */
export function defaultSnippet(def: ConfigFieldDefinition): string | null {
  if (def.defaultValue === null) return null;
  const numeric =
    def.dataType === "integer" ||
    def.dataType === "decimal" ||
    def.dataType === "number";
  const value =
    def.dataType === "boolean"
      ? def.defaultValue === "true"
      : numeric && Number.isFinite(Number(def.defaultValue))
        ? Number(def.defaultValue)
        : def.defaultValue;
  return JSON.stringify({ [def.fieldName]: value }, null, 2);
}

/**
 * รายละเอียด Parameter แบบ drawer ด้านขวา: ชนิด ค่าที่ยอมรับ ค่าเริ่มต้น หน่วย
 * โมเดลที่ใช้ได้ พร้อมปุ่มคัดลอกชื่อ/ค่าเริ่มต้น/snippet · ช่วงตัวเลขขั้นต่ำ-สูงสุด
 * ยังไม่มีใน API จึงไม่แสดง
 */
export function ParameterDetailDrawer({
  definition,
  onClose,
}: {
  definition: ConfigFieldDefinition | null;
  onClose: () => void;
}) {
  const d = definition;
  const snippet = d ? defaultSnippet(d) : null;

  return (
    <Sheet open={d !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md">
        {d && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-1 pr-8">
                <span className="font-instrument break-all">{d.fieldName}</span>
                <CopyButton value={d.fieldName} label="คัดลอกชื่อ field" />
              </SheetTitle>
              <SheetDescription>
                {d.description ?? "ไม่มีคำอธิบาย"}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
              <div className="flex flex-wrap gap-1.5">
                {d.required && <Flag tone="info">บังคับกรอก</Flag>}
                {d.restartRequired && <Flag tone="warning">ต้อง Restart กล่อง</Flag>}
                {d.sensitive && <Flag tone="warning">ค่าอ่อนไหว</Flag>}
                {d.stOverridable && <Flag tone="neutral">ST override ได้</Flag>}
                {d.unknownSpec && <Flag tone="neutral">ยังไม่มี spec</Flag>}
              </div>

              <div className="divide-y">
                <InfoRow label="ชนิดข้อมูล">
                  <span className="font-instrument">{d.dataType}</span>
                </InfoRow>
                <InfoRow label="หมวด">
                  {d.category ?? <span className="text-muted-foreground">-</span>}
                </InfoRow>
                <InfoRow label="หน่วย">
                  {d.unit ?? <span className="text-muted-foreground">-</span>}
                </InfoRow>
                <InfoRow label="ค่าเริ่มต้น">
                  {d.defaultValue === null ? (
                    <span className="text-muted-foreground">ไม่มี</span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {d.sensitive ? (
                        <SensitiveValue value={d.defaultValue} />
                      ) : (
                        <span className="font-instrument">{d.defaultValue}</span>
                      )}
                      <CopyButton value={d.defaultValue} label="คัดลอกค่าเริ่มต้น" />
                    </span>
                  )}
                </InfoRow>
              </div>

              <section className="flex flex-col gap-1.5">
                <h3 className="label-caps text-muted-foreground">ค่าที่ยอมรับ</h3>
                {d.allowedValues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    ไม่จำกัดค่า (ตรวจตามชนิดข้อมูล)
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.allowedValues.map((v) => (
                      <span
                        key={v}
                        className="rounded border bg-surface-sunken px-1.5 py-0.5 font-instrument text-xs"
                      >
                        {v}
                      </span>
                    ))}
                    <CopyButton
                      value={d.allowedValues.join(", ")}
                      label="คัดลอกค่าที่ยอมรับ"
                    />
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-1.5">
                <h3 className="label-caps text-muted-foreground">
                  โมเดล / โปรโตคอลที่รองรับ
                </h3>
                {d.supportedModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ยังไม่ระบุ</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {d.supportedModels.map((m) => (
                      <li
                        key={`${m.deviceModel}/${m.protocol}`}
                        className="text-sm"
                      >
                        {m.deviceModel}{" "}
                        <span className="text-muted-foreground">/ {m.protocol}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {snippet && !d.sensitive && (
                <section className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <h3 className="label-caps text-muted-foreground">
                      ตัวอย่างใส่ในไฟล์ Config
                    </h3>
                    <CopyButton value={snippet} label="คัดลอก snippet" />
                  </div>
                  <pre className="overflow-auto rounded-lg border bg-surface-sunken p-3 font-instrument text-xs">
                    {snippet}
                  </pre>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
