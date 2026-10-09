"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { canUploadFirmware } from "@/lib/permissions";
import { type Firmware } from "@/lib/firmware-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { UploadFirmwareForm } from "./upload-firmware-form";

/**
 * ปุ่ม "+ อัปโหลด Firmware" — FirmwareEngineer เท่านั้น (RBAC_Matrix.md Section 2 แถว
 * Firmware Repository) role อื่นไม่เห็นปุ่มนี้เลย (ดู Firmware ได้อย่างเดียว)
 *
 * เดิมพาไปหน้าเต็ม `/firmware/upload` — ย้ายมาเป็น Dialog (แก้ครั้งที่ 71 —
 * เดิม comment บอกว่า "ทำเป็นหน้าเต็มแทน Dialog เพราะต้องมีที่โชว์ error/ผล
 * อัปโหลด" ซึ่ง Dialog ใหม่รองรับ scroll ภายในแล้ว (`max-h-[85vh]`) พอแสดง
 * error ยาวๆ ได้โดยไม่ต้องเป็นหน้าเต็ม) — เป็น UX-level gate เท่านั้น backend
 * PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function UploadFirmwareButton({
  onUploaded,
}: {
  onUploaded: (firmware: Firmware) => void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);

  if (!canUploadFirmware(session?.role)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        + อัปโหลด Firmware
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>อัปโหลด Firmware</DialogTitle>
          <DialogDescription>
            ไฟล์จะถูกอัปโหลดขึ้น Object Storage ทันที · เพิ่ม/แก้
            รุ่นอุปกรณ์ที่รองรับเพิ่มเติมได้ทีหลังในหน้ารายละเอียด
          </DialogDescription>
        </DialogHeader>
        <UploadFirmwareForm
          onUploaded={(firmware) => {
            setOpen(false);
            onUploaded(firmware);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
