"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { decideIncident, type Incident } from "@/lib/incident-api";

const NOTE_MAX_LENGTH = 500;

const OUTCOMES = [
  { value: "resolve", label: "แก้แล้ว", hint: "แก้ไขหรือตรวจสอบเรียบร้อยแล้ว" },
  {
    value: "dismiss",
    label: "ไม่ต้องดำเนินการ",
    hint: "รับผลที่เกิดขึ้นได้ ไม่ต้องทำอะไรต่อ",
  },
] as const;

type Outcome = (typeof OUTCOMES)[number]["value"];

/**
 * ปิด Incident ที่ระบบสร้างเองหลายรายการพร้อมกัน (เรื่องเดียวกันที่เกิดซ้ำ) ด้วยผลและหมายเหตุเดียว
 * API ปิดได้ทีละรายการ (`POST /incidents/{id}/decide`) จึงยิงต่อกันตามลำดับแล้วสรุปผลรวม
 * รายการที่ปิดไม่ได้ (มีคนปิดก่อน ฯลฯ) ไม่ทำให้รายการอื่นหยุด · ต้องพิมพ์ CLOSE ก่อนยืนยัน
 */
export function BulkCloseIncidentsDialog({
  incidents,
  onDone,
}: {
  incidents: Incident[];
  /** เรียกเมื่อมีอย่างน้อย 1 รายการเปลี่ยนสถานะ ให้ผู้เรียกดึงรายการใหม่ */
  onDone: () => void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("resolve");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function closeAll(): Promise<boolean> {
    const token = session?.accessToken;
    const trimmed = note.trim();
    if (!token) return false;
    if (!trimmed) {
      setError("ต้องกรอกหมายเหตุ");
      return false;
    }
    setError(null);
    let done = 0;
    let lastError: string | null = null;
    for (const incident of incidents) {
      try {
        await decideIncident(token, incident.id, { outcome, note: trimmed });
        done += 1;
      } catch (err) {
        lastError =
          err instanceof ApiError ? err.message : "ปิด Incident ไม่สำเร็จ";
      }
    }
    if (done > 0) onDone();
    if (done === incidents.length) {
      toast.success(`ปิด ${done} รายการแล้ว`);
      setNote("");
      return true;
    }
    if (done === 0) {
      setError(lastError ?? "ปิด Incident ไม่สำเร็จ");
      return false;
    }
    toast.warning(
      `ปิดได้ ${done} จาก ${incidents.length} รายการ ที่เหลือมีคนปิดไปก่อนหรือเกิดข้อผิดพลาด`,
    );
    setNote("");
    return true;
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        ปิดทั้ง {incidents.length} รายการ
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`ปิด ${incidents.length} Incident พร้อมกัน`}
        description={`${incidents[0]?.title ?? ""} ทั้ง ${incidents.length} รายการจะถูกปิดด้วยผลและหมายเหตุเดียวกัน ย้อนกลับไม่ได้`}
        confirmLabel={`ปิด ${incidents.length} รายการ`}
        confirmText="CLOSE"
        onConfirm={closeAll}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">ผลการตัดสินใจ</legend>
          {OUTCOMES.map((o) => (
            <label
              key={o.value}
              className={
                "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm " +
                (outcome === o.value ? "border-primary bg-primary/5" : "")
              }
            >
              <input
                type="radio"
                name="bulk-close-outcome"
                checked={outcome === o.value}
                onChange={() => setOutcome(o.value)}
                className="mt-1"
              />
              <span className="flex flex-col">
                <span className="font-medium">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-close-note">หมายเหตุ</Label>
          <textarea
            id="bulk-close-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder="เหตุผลที่ปิด บันทึกไว้ใน Audit Log"
            className="min-h-20 resize-y rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
