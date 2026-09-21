"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canUploadFirmware } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { uploadFirmware } from "@/lib/firmware-api";
import { formatFileSize } from "@/lib/format-bytes";
import { Button } from "@/components/ui/button";
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
 * ขึ้น Object Storage จริง) → สำเร็จเด้งไปหน้ารายการ พร้อม highlight แถวที่
 * เพิ่งอัปโหลด (เหมือน flow ของ Config Import) — `uploadStatus` อาจเป็น
 * `failed` ได้แม้ request คืน 201 (Object Storage ล่ม) ไม่ใช่ error ต้อง
 * แสดงผลแยก ไม่ใช่ throw
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function UploadFirmwareForm() {
  const { session } = useAuth();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // bump เพื่อ remount <input type="file"> ตอนกด "ล้าง" (input file คุมค่าไม่ได้)
  const [fileInputNonce, setFileInputNonce] = useState(0);

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
    setFileInputNonce((n) => n + 1);
  }

  function onPick(picked: File | null) {
    setFormError(null);
    if (picked && picked.size > MAX_FILE_BYTES) {
      setFile(null);
      setFormError(
        `ไฟล์ใหญ่เกิน ${formatFileSize(MAX_FILE_BYTES)} — เกินขนาดที่ระบบรับ`,
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
      setFormError("ต้องระบุรุ่นอุปกรณ์อย่างน้อย 1 รุ่น");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const created = await uploadFirmware(session.accessToken, {
        file,
        version: trimmedVersion,
        deviceModel: trimmedModel,
      });
      toast.success(`อัปโหลด Firmware "${created.version}" แล้ว`);
      router.push(`/firmware?uploaded=${encodeURIComponent(created.id)}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        if (err.statusCode === 413) {
          const message = `ไฟล์ใหญ่เกิน ${formatFileSize(MAX_FILE_BYTES)} — เกินขนาดที่ระบบรับ`;
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
        <Label htmlFor="firmware-file">ไฟล์ Firmware</Label>
        <Input
          key={fileInputNonce}
          id="firmware-file"
          type="file"
          disabled={submitting}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        {file && (
          <p className="text-xs text-muted-foreground">
            {file.name} · {formatFileSize(file.size)}
          </p>
        )}
      </div>

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
          รุ่นอุปกรณ์ (compatibility tag เริ่มต้น)
        </Label>
        <Input
          id="firmware-device-model"
          value={deviceModel}
          disabled={submitting}
          placeholder="เช่น GT06N"
          onChange={(e) => setDeviceModel(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          เพิ่มรุ่นอื่นที่รองรับด้วยได้ทีหลังในหน้ารายละเอียด (Compatibility Tag)
        </p>
      </div>

      {formError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      <div className="flex gap-2">
        <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
          {submitting ? "กำลังอัปโหลด…" : "อัปโหลด"}
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
