"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { importConfig } from "@/lib/config-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** ตรงกับ backend `IMPORT_FILE_SIZE_LIMIT_BYTES` (1MB) — เช็คฝั่ง client ก่อน
 *  เพื่อไม่ให้ผู้ใช้รออัปโหลดไฟล์ใหญ่แล้วเจอ 413 */
const MAX_FILE_BYTES = 1024 * 1024;

/** field ที่ backend (`CreateConfigDto`) บังคับ — ใช้เตือนฝั่ง client ก่อนส่ง
 *  ตัว validate จริง (รวม semantic เทียบ ConfigFieldDefinition) อยู่ที่ backend */
const REQUIRED_KEYS = ["name", "deviceModel", "protocol", "fields"] as const;

/** ไฟล์ตัวอย่างให้ดาวน์โหลด — โครงเดียวกับที่ Config Editor (ฟอร์ม) สร้าง */
const TEMPLATE = {
  name: "ตัวอย่าง Config SMARTEYEPLUS",
  deviceModel: "SMARTEYEPLUS",
  protocol: "TCP",
  description: "อธิบายสั้น ๆ ว่า Config ชุดนี้ทำไว้เพื่ออะไร (ไม่บังคับ)",
  fields: { APN1: "internet", MTYP: "1", SIM1: "0812345678" },
};

type Preview = {
  name: string | null;
  deviceModel: string | null;
  protocol: string | null;
  fieldCount: number | null;
  missing: string[];
};

type ParseResult = { ok: true; preview: Preview } | { ok: false; error: string };

function parsePreview(text: string): ParseResult {
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
  const fields = obj.fields;
  const fieldsIsObject =
    typeof fields === "object" && fields !== null && !Array.isArray(fields);

  const missing = REQUIRED_KEYS.filter((k) => {
    if (k === "fields") return !fieldsIsObject;
    return asText(obj[k]) === null;
  });

  return {
    ok: true,
    preview: {
      name: asText(obj.name),
      deviceModel: asText(obj.deviceModel),
      protocol: asText(obj.protocol),
      fieldCount: fieldsIsObject
        ? Object.keys(fields as Record<string, unknown>).length
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
 * ฟอร์ม Import Config จากไฟล์ JSON — เฉพาะ Role SW (RBAC_Matrix.md Section 2
 * แถว Config Import) role อื่นเห็นข้อความแทนฟอร์ม
 *
 * flow: เลือกไฟล์ → preview ฝั่ง client (parse + เช็ค field บังคับ) → กด "นำเข้า"
 * → `POST /config/import` (multipart) → สำเร็จเด้งไปหน้ารายการ Config พร้อม
 * highlight แถวที่เพิ่ง import (เหมือน flow สร้างผ่าน wizard) · Config ที่ได้
 * เป็นสถานะ `draft` ต้อง simulate + Operation approve เหมือนกันทุกประการ
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function ImportConfigForm() {
  const { session } = useAuth();
  const router = useRouter();

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
        เฉพาะ Role SW เท่านั้นที่นำเข้า Config ได้
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
        error: "ไฟล์ใหญ่เกิน 1MB — เกินขนาดที่ระบบรับ",
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
      router.push(`/config?saved=${encodeURIComponent(created.id)}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.statusCode === 409) {
          setFormError(
            `${err.message} — เปลี่ยนค่า "name" ในไฟล์แล้วลองใหม่`,
          );
          return;
        }
        setFormError(err.message);
        setFormErrorList(err.details ?? []);
        return;
      }
      setFormError("นำเข้า Config ไม่สำเร็จ");
    }
  }

  const preview = parse?.ok ? parse.preview : null;
  const canSubmit = file !== null && parse?.ok === true && !submitting;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="config-file">ไฟล์ Config (.json)</Label>
        <Input
          key={fileInputNonce}
          id="config-file"
          type="file"
          accept="application/json,.json"
          disabled={submitting}
          onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={downloadTemplate}
          className="self-start text-xs text-muted-foreground underline hover:text-foreground"
        >
          ดาวน์โหลดไฟล์ตัวอย่าง
        </button>
      </div>

      {parse?.ok === false && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {parse.error}
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">ตรวจไฟล์ก่อนนำเข้า</p>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>ชื่อ</dt>
            <dd className="text-foreground">{preview.name ?? "—"}</dd>
            <dt>รุ่นอุปกรณ์</dt>
            <dd className="text-foreground">{preview.deviceModel ?? "—"}</dd>
            <dt>โปรโตคอล</dt>
            <dd className="text-foreground">{preview.protocol ?? "—"}</dd>
            <dt>จำนวน field</dt>
            <dd className="text-foreground">
              {preview.fieldCount ?? "—"}
            </dd>
          </dl>
          {preview.missing.length > 0 && (
            <p className="text-destructive">
              ไฟล์ยังขาด: {preview.missing.join(", ")} — backend จะปฏิเสธถ้าไม่ครบ
            </p>
          )}
        </div>
      )}

      {formError && (
        <div className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
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

      <div className="flex gap-2">
        <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
          {submitting ? "กำลังนำเข้า…" : "นำเข้า"}
        </Button>
        {file && (
          <Button variant="ghost" disabled={submitting} onClick={reset}>
            ล้าง
          </Button>
        )}
      </div>
    </div>
  );
}
