"use client";

import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { canUpdateConfig } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { deleteConfig, type Config } from "@/lib/config-api";
import { CONFIG_STATUS_TONE, pillClass } from "@/lib/status-pill";
import { formatDateTime } from "@/lib/format-date";

/** value ของ field อาจเป็น object/array — โชว์เป็น JSON แบบ indent (อ่านออก),
 * string โชว์ตรงๆ */
function renderFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right break-words">{children}</span>
    </div>
  );
}

/**
 * แผงรายละเอียด Config (คลิกแถวในตาราง) — read-only ทั้งหมด · ปุ่มลบโผล่เฉพาะ
 * Config สถานะ `draft` และ Role SW (เงื่อนไขเดียวกับ backend — สถานะอื่นลบไม่ได้
 * DELETE /config/:id ตอบ 409) ฟอร์มสร้าง/แก้ไขยังไม่ทำในนี้ (PR ถัดไป — ต้องต่อ
 * GET /config-definitions มาทำ field editor)
 */
export function ConfigDetailSheet({
  config,
  onOpenChange,
  onEdit,
  onDeleted,
}: {
  config: Config | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (config: Config) => void;
  onDeleted: () => void;
}) {
  return (
    <Sheet open={config !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {config && (
          <ConfigDetailContent
            key={config.id}
            config={config}
            onEdit={onEdit}
            onDeleted={onDeleted}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** เนื้อหาแผง — แยกออกมาเพื่อให้ state (ยืนยันลบ/error) รีเซ็ตเองผ่าน `key` เมื่อ
 * เลือก Config ตัวใหม่ */
function ConfigDetailContent({
  config,
  onEdit,
  onDeleted,
}: {
  config: Config;
  onEdit: (config: Config) => void;
  onDeleted: () => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // draft + SW เท่านั้นที่แก้/ลบได้ (เงื่อนไขเดียวกับ backend)
  const canModify =
    config.status === "draft" && canUpdateConfig(session?.role);

  async function handleDelete() {
    if (!session?.accessToken) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteConfig(session.accessToken, config.id);
      onDeleted();
    } catch (err) {
      setDeleting(false);
      setError(err instanceof ApiError ? err.message : "ลบ Config ไม่สำเร็จ");
    }
  }

  const fieldEntries = Object.entries(config.fields);

  return (
    <>
      <SheetHeader className="gap-2">
        <SheetTitle className="break-words pr-8">{config.name}</SheetTitle>
        <div>
          <span
            className={pillClass(CONFIG_STATUS_TONE[config.status] ?? "neutral")}
          >
            {config.status}
          </span>
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4 pb-4">
        {config.description && (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {config.description}
          </p>
        )}

        <div className="divide-y">
          <InfoRow label="รุ่นอุปกรณ์">{config.deviceModel}</InfoRow>
          <InfoRow label="โปรโตคอล">{config.protocol}</InfoRow>
          <InfoRow label="สร้างโดย">
            <span className="font-mono text-xs">{config.createdBy}</span>
          </InfoRow>
          <InfoRow label="ผู้อนุมัติ">
            {config.approvedBy ? (
              <span className="font-mono text-xs">{config.approvedBy}</span>
            ) : (
              "-"
            )}
          </InfoRow>
          <InfoRow label="สร้างเมื่อ">
            {formatDateTime(config.createdAt)}
          </InfoRow>
          <InfoRow label="แก้ไขล่าสุด">
            {formatDateTime(config.updatedAt)}
          </InfoRow>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">
            พารามิเตอร์{" "}
            <span className="text-muted-foreground">
              ({fieldEntries.length})
            </span>
          </p>
          {fieldEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              ยังไม่ได้ตั้งค่าพารามิเตอร์
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {fieldEntries.map(([key, value]) => {
                const rendered = renderFieldValue(value);
                const multiline = rendered.includes("\n");
                return (
                  <div
                    key={key}
                    className="flex justify-between gap-4 px-3 py-2 text-sm"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {key}
                    </span>
                    <span
                      className={
                        "min-w-0 font-mono text-xs break-words whitespace-pre-wrap " +
                        (multiline ? "text-left" : "text-right")
                      }
                    >
                      {rendered}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {canModify && (
        <SheetFooter>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                ลบ Config &ldquo;{config.name}&rdquo; ถาวร? กู้คืนไม่ได้
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "กำลังลบ…" : "ยืนยันลบ"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                >
                  ยกเลิก
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button onClick={() => onEdit(config)}>แก้ไข</Button>
              <Button
                variant="destructive"
                onClick={() => setConfirming(true)}
              >
                ลบ
              </Button>
            </div>
          )}
        </SheetFooter>
      )}
    </>
  );
}
