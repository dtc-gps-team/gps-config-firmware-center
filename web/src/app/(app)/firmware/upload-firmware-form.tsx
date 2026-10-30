"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canUploadFirmware } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { uploadFirmware, type Firmware } from "@/lib/firmware-api";
import { formatFileSize } from "@/lib/format-bytes";
import { CopyButton } from "@/components/copy-button";
import { FileDropzone } from "@/components/file-dropzone";
import { ProgressBar } from "@/components/progress-bar";
import { Button } from "@/components/ui/button";
import { sha256Hex } from "@/lib/file-checksum";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** ตรงกับ backend `UPLOAD_FILE_SIZE_LIMIT_BYTES` (50MB) — เช็คฝั่ง client
 *  ก่อนเพื่อไม่ให้ผู้ใช้รออัปโหลดไฟล์ใหญ่แล้วเจอ 413 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * ฟอร์มอัปโหลด Firmware — เฉพาะ Role FirmwareEngineer (RBAC_Matrix.md ตาราง 4.1
 * `POST /firmware`) role อื่นเห็นข้อความแทนฟอร์ม
 *
 * flow: เลือกไฟล์ + กรอกเวอร์ชัน/รุ่นอุปกรณ์เริ่มต้น (compatibility tag
 * เริ่มต้น 1 รุ่น) → กด "อัปโหลด" → `POST /firmware` (multipart, synchronous
 * ขึ้น Object Storage จริง) → สำเร็จเรียก `onUploaded` ให้ parent ปิด dialog +
 * highlight แถวที่เพิ่งอัปโหลด (เหมือน flow ของ Config Import) — `uploadStatus`
 * อาจเป็น `failed` ได้แม้ request คืน 201 (Object Storage ล่ม) ไม่ใช่ error
 * ต้องแสดงผลแยก ไม่ใช่ throw
 *
 * เดิมเป็นหน้าเต็ม `/firmware/upload` — ย้ายมาเป็น Dialog (แก้ครั้งที่ 71)
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function UploadFirmwareForm({
  onUploaded,
}: {
  onUploaded: (firmware: Firmware) => void;
}) {
  const { session } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  // SHA-256 ของไฟล์ที่เลือก คำนวณในเครื่องเพื่อเทียบกับ checksum ที่ระบบเก็บหลังอัปโหลด
  const [sum, setSum] = useState<{ file: File; hex: string | null } | null>(null);
  const checksum = file && sum?.file === file ? sum.hex : null;

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void sha256Hex(file).then((hex) => {
      if (!cancelled) setSum({ file, hex });
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!canUploadFirmware(session?.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        เฉพาะ Role FirmwareEngineer เท่านั้นที่อัปโหลด Firmware ได้
      </p>
    );
  }

  function reset() {
    setFile(null);
    setVersion("");
    setDeviceModel("");
    setFormError(null);
    setProgress(0);
  }

  function onPick(picked: File | null) {
    setFormError(null);
    if (picked && picked.size > MAX_FILE_BYTES) {
      setFile(null);
      setFormError(
        `ไฟล์ใหญ่เกิน ${formatFileSize(MAX_FILE_BYTES)} เกินขนาดที่ระบบรับ`,
      );
      return;
    }
    setFile(picked);
  }

  async function onSubmit() {
    if (!file || !session?.accessToken) return;
    const trimmedVersion = version.trim();
    const trimmedModel = deviceModel.trim();
    if (!trimmedVersion) {
      setFormError("ต้องระบุเวอร์ชัน");
      return;
    }
    if (!trimmedModel) {
      setFormError("ต้องระบุโมเดลอย่างน้อย 1 โมเดล");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setProgress(0);
    try {
      const created = await uploadFirmware(
        session.accessToken,
        { file, version: trimmedVersion, deviceModel: trimmedModel },
        setProgress,
      );
      toast.success(`อัปโหลด Firmware "${created.version}" แล้ว`);
      onUploaded(created);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.statusCode === 413) {
          const message = `ไฟล์ใหญ่เกิน ${formatFileSize(MAX_FILE_BYTES)} เกินขนาดที่ระบบรับ`;
          setFormError(message);
          toast.error(message);
          return;
        }
        setFormError(err.message);
        toast.error(err.message);
        return;
      }
      setFormError("อัปโหลด Firmware ไม่สำเร็จ");
      toast.error("อัปโหลด Firmware ไม่สำเร็จ");
    }
  }

  const canSubmit =
    file !== null && version.trim() !== "" && deviceModel.trim() !== "" && !submitting;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FileDropzone label="ไฟล์ Firmware" disabled={submitting} onPick={onPick}>
          {file ? (
            <span className="font-instrument">
              {file.name}, {formatFileSize(file.size)}
            </span>
          ) : undefined}
        </FileDropzone>
        {file && checksum && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            SHA-256
            <span className="font-instrument break-all">{checksum}</span>
            <CopyButton value={checksum} label="คัดลอก SHA-256" />
          </p>
        )}
        {submitting && (
          <div className="flex items-center gap-2">
            <ProgressBar value={progress} label="ความคืบหน้าการอัปโหลด" />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {progress}%
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firmware-version">เวอร์ชัน</Label>
          <Input
            id="firmware-version"
            value={version}
            disabled={submitting}
            placeholder="เช่น 2.4.1"
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firmware-device-model">
            โมเดล (compatibility tag เริ่มต้น)
          </Label>
          <Input
            id="firmware-device-model"
            value={deviceModel}
            disabled={submitting}
            placeholder="เช่น GT06N"
            onChange={(e) => setDeviceModel(e.target.value)}
          />
        </div>

        <p className="text-xs text-muted-foreground sm:col-span-2">
          เพิ่มโมเดลอื่นที่รองรับด้วยได้ทีหลังในหน้ารายละเอียด (Compatibility Tag)
        </p>
      </div>

      {formError && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      <div className="flex gap-2">
        <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
          {submitting ? `กำลังอัปโหลด ${progress}%` : "อัปโหลด"}
        </Button>
        {(file || version || deviceModel) && (
          <Button variant="ghost" disabled={submitting} onClick={reset}>
            ล้าง
          </Button>
        )}
      </div>
    </div>
  );
}
