"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { importConfig, type Config } from "@/lib/config-api";
import { flattenFields } from "@/lib/config-fields";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/file-dropzone";
import { formatFileSize } from "@/lib/format-bytes";
import {
  CircleCheckIcon,
  DownloadIcon,
  FileJsonIcon,
  TriangleAlertIcon,
} from "lucide-react";

/** ตรงกับ backend `IMPORT_FILE_SIZE_LIMIT_BYTES` (1MB) — เช็คฝั่ง client ก่อน
 *  เพื่อไม่ให้ผู้ใช้รออัปโหลดไฟล์ใหญ่แล้วเจอ 413 */
const MAX_FILE_BYTES = 1024 * 1024;

/** field ที่ backend (`CreateConfigDto`) บังคับ — ใช้เตือนฝั่ง client ก่อนส่ง
 *  ตัว validate จริง (รวม semantic เทียบ ConfigFieldDefinition) อยู่ที่ backend
 *  · ไม่รวม `fields`/`settings` เพราะมีได้แค่อย่างใดอย่างหนึ่ง (เช็คแยกด้านล่าง
 *  — backend v3.67 รองรับทั้งสอง format, รีวิวพี่เลี้ยง 27 ต.ค. 2569) */
const REQUIRED_KEYS = ["name", "deviceModel", "protocol"] as const;

/** ไฟล์ตัวอย่างให้ดาวน์โหลด — โครงเดียวกับที่หน้า Config Detail export ให้
 *  ตั้งแต่ v3.67 (`settings` ซ้อนชั้น ตรงกับ JSON ที่ส่งเข้า Server กลางจริง) —
 *  รุ่นนี้ key ไม่มีจุดอยู่แล้ว (SMARTEYEPLUS) จึงซ้อนชั้นแบบไม่มีผล (no-op)
 *  เหมือนไฟล์เดิม ไฟล์เก่าที่ใช้ `fields` แบนยังนำเข้าได้ปกติ */
const TEMPLATE = {
  name: "ตัวอย่าง Config SMARTEYEPLUS",
  deviceModel: "SMARTEYEPLUS",
  protocol: "TCP",
  description: "อธิบายสั้น ๆ ว่า Config ชุดนี้ทำไว้เพื่ออะไร (ไม่บังคับ)",
  settings: { APN1: "internet", MTYP: "1", SIM1: "0812345678" },
};

type Preview = {
  name: string | null;
  deviceModel: string | null;
  protocol: string | null;
  fieldCount: number | null;
  missing: string[];
};

type ParseResult = { ok: true; preview: Preview } | { ok: false; error: string };

export function parsePreview(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "ไฟล์ไม่ใช่ JSON ที่ถูกต้อง (อ่านโครงสร้างไม่ผ่าน)" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "เนื้อหา JSON ต้องเป็น object เดียว (ไม่ใช่ array หรือค่าเดี่ยว)",
    };
  }

  const obj = parsed as Record<string, unknown>;
  const asText = (v: unknown) =>
    typeof v === "string" && v.trim() ? v : null;

  // รับได้ 2 format (เลือกอย่างใดอย่างหนึ่ง): "settings" ซ้อนชั้น (ของใหม่
  // ตรงกับที่ Config Detail export ให้ตั้งแต่ v3.67) หรือ "fields" แบนแบบเดิม
  // — มีพร้อมกันทั้งคู่ถือว่ากำกวม backend ปฏิเสธเหมือนกัน (ไม่เดาให้)
  const hasFields = Object.hasOwn(obj, "fields");
  const hasSettings = Object.hasOwn(obj, "settings");
  if (hasFields && hasSettings) {
    return {
      ok: false,
      error: 'ไฟล์มีทั้ง "fields" และ "settings" พร้อมกันไม่ได้ — ใช้อย่างใดอย่างหนึ่ง',
    };
  }
  const rawFields = hasSettings ? obj.settings : obj.fields;
  const fieldsIsObject =
    typeof rawFields === "object" &&
    rawFields !== null &&
    !Array.isArray(rawFields);

  const missing: string[] = REQUIRED_KEYS.filter(
    (k) => asText(obj[k]) === null,
  );
  if (!fieldsIsObject) missing.push(hasSettings ? "settings" : "fields");

  return {
    ok: true,
    preview: {
      name: asText(obj.name),
      deviceModel: asText(obj.deviceModel),
      protocol: asText(obj.protocol),
      fieldCount: fieldsIsObject
        ? Object.keys(
            flattenFields(rawFields as Record<string, unknown>),
          ).length
        : null,
      missing,
    },
  };
}

function downloadTemplate() {
  const blob = new Blob([JSON.stringify(TEMPLATE, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "config-template.json";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * ฟอร์ม Import Config จากไฟล์ JSON — เฉพาะ Role ConfigEngineer (RBAC_Matrix.md Section 2
 * แถว Config Import) role อื่นเห็นข้อความแทนฟอร์ม
 *
 * flow: เลือกไฟล์ → preview ฝั่ง client (parse + เช็ค field บังคับ) → กด "นำเข้า"
 * → `POST /config/import` (multipart) → สำเร็จเรียก `onImported` ให้ parent
 * ปิด dialog + highlight แถวที่เพิ่ง import (เหมือน flow สร้างผ่าน wizard) ·
 * Config ที่ได้เป็นสถานะ `draft` ต้อง simulate + Operation approve เหมือนกัน
 * ทุกประการ
 *
 * เดิมเป็นหน้าเต็ม `/config/import` — ย้ายมาเป็น Dialog (แก้ครั้งที่ 71 —
 * เดิม comment บอกว่า "ทำเป็นหน้าเต็มแทน Dialog เพราะต้องมีที่โชว์ preview +
 * รายการ error" ซึ่ง Dialog ใหม่รองรับ scroll ภายในแล้ว พอแสดง preview/error
 * ได้โดยไม่ต้องเป็นหน้าเต็ม)
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function ImportConfigForm({
  onImported,
}: {
  onImported: (config: Config) => void;
}) {
  const { session } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorList, setFormErrorList] = useState<string[]>([]);
  // bump เพื่อ remount <input type="file"> ตอนกด "ล้าง" (input file คุมค่าไม่ได้)
  const [fileInputNonce, setFileInputNonce] = useState(0);

  if (!canCreateConfig(session?.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        เฉพาะ Role ConfigEngineer เท่านั้นที่นำเข้า Config ได้
      </p>
    );
  }

  function reset() {
    setFile(null);
    setParse(null);
    setFormError(null);
    setFormErrorList([]);
    setFileInputNonce((n) => n + 1);
  }

  async function onPick(picked: File | null) {
    setFormError(null);
    setFormErrorList([]);
    if (!picked) {
      setFile(null);
      setParse(null);
      return;
    }
    setFile(picked);
    if (picked.size > MAX_FILE_BYTES) {
      setParse({
        ok: false,
        error: "ไฟล์ใหญ่เกิน 1MB เกินขนาดที่ระบบรับ",
      });
      return;
    }
    setParse(parsePreview(await picked.text()));
  }

  async function onSubmit() {
    if (!file || !session?.accessToken) return;
    setSubmitting(true);
    setFormError(null);
    setFormErrorList([]);
    try {
      const created = await importConfig(session.accessToken, file);
      toast.success(`นำเข้า "${created.name}" แล้ว`);
      onImported(created);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.statusCode === 409) {
          const message = `${err.message} เปลี่ยนค่า "name" ในไฟล์แล้วลองใหม่`;
          setFormError(message);
          toast.error(message);
          return;
        }
        setFormError(err.message);
        setFormErrorList(err.details ?? []);
        toast.error(err.message);
        return;
      }
      setFormError("นำเข้า Config ไม่สำเร็จ");
      toast.error("นำเข้า Config ไม่สำเร็จ");
    }
  }

  const preview = parse?.ok ? parse.preview : null;
  const canSubmit = file !== null && parse?.ok === true && !submitting;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <FileDropzone
          key={fileInputNonce}
          label="ไฟล์ Config (.json)"
          accept="application/json,.json"
          disabled={submitting}
          onPick={(f) => void onPick(f)}
        >
          {file ? (
            <span className="inline-flex items-center gap-1.5 font-instrument">
              <FileJsonIcon className="size-3.5" />
              {file.name}, {formatFileSize(file.size)}
            </span>
          ) : (
            "ลากไฟล์ .json มาวางที่นี่ หรือกดเพื่อเลือกไฟล์ (ไม่เกิน 1MB)"
          )}
        </FileDropzone>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={downloadTemplate}
        >
          <DownloadIcon />
          ดาวน์โหลดไฟล์ตัวอย่าง
        </Button>
      </div>

      {parse?.ok === false && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {parse.error}
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-3 rounded-lg border bg-surface-sunken p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            {preview.missing.length === 0 ? (
              <>
                <CircleCheckIcon className="size-4 text-success" />
                ไฟล์พร้อมนำเข้า
              </>
            ) : (
              <>
                <TriangleAlertIcon className="size-4 text-warning" />
                ไฟล์ยังไม่ครบ
              </>
            )}
          </p>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-muted-foreground">
            <dt>ชื่อ</dt>
            <dd className="text-foreground">{preview.name ?? "-"}</dd>
            <dt>โมเดล</dt>
            <dd className="font-instrument text-foreground">{preview.deviceModel ?? "-"}</dd>
            <dt>โปรโตคอล</dt>
            <dd className="font-instrument text-foreground">{preview.protocol ?? "-"}</dd>
            <dt>จำนวน field</dt>
            <dd className="text-foreground tabular-nums">
              {preview.fieldCount ?? "-"}
            </dd>
          </dl>
          {preview.missing.length > 0 && (
            <p className="text-destructive">
              ไฟล์ยังขาด: {preview.missing.join(", ")}, backend จะปฏิเสธถ้าไม่ครบ
            </p>
          )}
        </div>
      )}

      {formError && (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{formError}</p>
          {formErrorList.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-destructive">
              {formErrorList.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        {file && (
          <Button variant="ghost" disabled={submitting} onClick={reset}>
            ล้าง
          </Button>
        )}
        <Button disabled={!canSubmit} loading={submitting} onClick={() => void onSubmit()}>
          {submitting ? "กำลังนำเข้า…" : "นำเข้า"}
        </Button>
      </div>
    </div>
  );
}
