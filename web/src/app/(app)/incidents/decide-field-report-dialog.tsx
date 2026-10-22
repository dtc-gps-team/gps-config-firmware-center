"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import {
  decideIncident,
  type Incident,
  type IncidentDecisionOutcome,
  type IncidentDecisionResult,
} from "@/lib/incident-api";

const NOTE_MAX_LENGTH = 1000;

const OUTCOME_OPTIONS: {
  value: IncidentDecisionOutcome;
  label: string;
  hint: string;
}[] = [
  {
    value: "resolve",
    label: "แก้แล้ว",
    hint: "ปัญหาถูกแก้เรียบร้อยแล้ว ปิดรายการ",
  },
  {
    value: "dismiss",
    label: "ไม่ต้องดำเนินการ",
    hint: "ตรวจแล้วไม่พบปัญหา หรือเป็นการแจ้งซ้ำกับรายการเดิม ปิดรายการ",
  },
  {
    value: "promote",
    label: "ส่งต่อเป็น Campaign",
    hint: "ต้องแก้ด้วยการ Rollout ไปยังอุปกรณ์ ไปสร้างกลุ่มอุปกรณ์ต่อทันที",
  },
];

/** ตัวเลือกตอนปิด Incident ที่ระบบสร้างเอง (ไม่มีส่งต่อเป็น Campaign: Rollout มีทาง
 * Rollback ของตัวเอง และ backend ตอบ 400 ถ้าขอ promote) */
const SYSTEM_OUTCOME_OPTIONS: typeof OUTCOME_OPTIONS = [
  {
    value: "resolve",
    label: "แก้แล้ว",
    hint: "แก้ปัญหาเรียบร้อยแล้ว (เช่น เขียนเข้าระบบปลายทางเองแล้ว) ปิดรายการ",
  },
  {
    value: "dismiss",
    label: "ไม่ต้องดำเนินการ",
    hint: "รับผลที่เกิดขึ้นได้ ไม่ต้องทำอะไรต่อ (เช่น เครื่องที่ล้มถูกถอดออกจากรถแล้ว) ปิดรายการ",
  },
];

/**
 * ปุ่ม "ตัดสินใจ" Field Report สำหรับ Operation (issue #284, backend #267) —
 * 3 ทางเลือกตาม `POST /incidents/{id}/decide` พร้อมหมายเหตุที่ต้องกรอก
 * (ช่างผู้แจ้งได้รับแจ้งเตือนพร้อมผลนี้)
 *
 * `variant="system"` = ปิด Incident ที่ระบบสร้างเอง (Rollout ล้มเหลว, เขียน Config
 * ไม่สำเร็จ) ด้วยมือ: ตัวเลือกเหลือแค่ "แก้แล้ว" กับ "ไม่ต้องดำเนินการ" ไม่มีผู้
 * รายงานจึงไม่มีการแจ้งเตือนใคร ใช้ endpoint เดียวกัน (`POST /incidents/{id}/decide`)
 *
 * - 409 = Operation อีกคนตัดสินไปก่อน: แจ้งผู้ใช้แล้วให้หน้ารีเฟรชรายการ
 * - 404 = ไม่ใช่ Field Report/ไม่พบรายการ
 * - promote สำเร็จ: ส่งผลกลับให้ผู้เรียกพาไปหน้าสร้างกลุ่มอุปกรณ์ต่อ
 */
export function DecideFieldReportDialog({
  incident,
  variant = "field-report",
  onDecided,
  onStale,
}: {
  incident: Incident;
  variant?: "field-report" | "system";
  onDecided: (
    result: IncidentDecisionResult,
    outcome: IncidentDecisionOutcome,
  ) => void;
  /** 409/404: รายการเปลี่ยนไปแล้ว (มีคนตัดสินก่อน) ให้ผู้เรียกดึงรายการใหม่ */
  onStale: () => void;
}) {
  const { session } = useAuth();
  const isSystem = variant === "system";
  const outcomeOptions = isSystem ? SYSTEM_OUTCOME_OPTIONS : OUTCOME_OPTIONS;
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<IncidentDecisionOutcome | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOutcome(null);
    setNote("");
    setError(null);
    setSubmitting(false);
  }

  async function submit() {
    if (!session?.accessToken || !outcome) return;
    const trimmed = note.trim();
    if (!trimmed) {
      setError("ต้องกรอกหมายเหตุ");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await decideIncident(session.accessToken, incident.id, {
        outcome,
        note: trimmed,
      });
      toast.success(
        isSystem
          ? `ปิด "${incident.title}" แล้ว`
          : `บันทึกการตัดสินใจ "${incident.title}" แล้ว`,
      );
      setOpen(false);
      reset();
      onDecided(result, outcome);
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError
          ? err.message
          : isSystem
            ? "ปิด Incident ไม่สำเร็จ"
            : "บันทึกการตัดสินใจไม่สำเร็จ";
      setError(message);
      toast.error(message);
      if (
        err instanceof ApiError &&
        (err.statusCode === 409 || err.statusCode === 404)
      ) {
        onStale();
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={<Button size="sm" variant={isSystem ? "outline" : "default"} />}
      >
        {isSystem ? "ปิด Incident" : "ตัดสินใจ"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isSystem ? "ปิด Incident" : "ตัดสินใจรายงานปัญหา"}
          </DialogTitle>
          <DialogDescription>
            {incident.title}
            {incident.deviceId ? ` (อุปกรณ์ ${incident.deviceId})` : ""}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">ผลการตัดสินใจ</legend>
          {outcomeOptions.map((o) => (
            <label
              key={o.value}
              className={
                "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm " +
                (outcome === o.value ? "border-primary bg-primary/5" : "")
              }
            >
              <input
                type="radio"
                name="decide-outcome"
                value={o.value}
                checked={outcome === o.value}
                onChange={() => {
                  setOutcome(o.value);
                  setError(null);
                }}
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
          <Label htmlFor="decide-note">หมายเหตุ</Label>
          <textarea
            id="decide-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder={
              isSystem
                ? "เหตุผลที่ปิด Incident นี้ บันทึกไว้ใน Audit Log"
                : "เหตุผลของการตัดสินใจ ถ้าไม่ตรงกับตัวเลือกด้านบนให้อธิบายเพิ่ม ช่างผู้แจ้งจะเห็นข้อความนี้"
            }
            className="min-h-20 resize-y rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <p className="text-right text-xs text-muted-foreground">
            {note.length}/{NOTE_MAX_LENGTH}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => setOpen(false)}
          >
            ยกเลิก
          </Button>
          <Button
            disabled={submitting || !outcome || note.trim() === ""}
            onClick={() => void submit()}
          >
            {submitting ? "กำลังบันทึก…" : "ยืนยัน"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
