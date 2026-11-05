"use client";

import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ApiError } from "@/lib/api";
import {
  deleteDeviceModel,
  updateDeviceModel,
  type DeviceModel,
} from "@/lib/device-model-api";
import { Button } from "@/components/ui/button";

/**
 * ปุ่มหลัก: สลับ active/discontinued ("เลิกผลิต") — Admin/SuperAdmin เท่านั้นที่เห็นหน้านี้อยู่แล้ว
 * (gate ที่ `device-model-management-view.tsx`) เรียก `PATCH /device-models/{id}` ทันทีตอนกด
 * (ไม่มีปุ่ม "บันทึก" แยก mirror `UserRowActions.toggleActive`)
 *
 * ปุ่มรอง "ลบ" (มติ A 2026-11-05): ลบจริงได้เฉพาะรุ่นที่ไม่มีอะไรอ้างอิง (เช่นสร้างรุ่นผิดชื่อ) —
 * ถ้ามีอุปกรณ์/Config/Firmware/พารามิเตอร์อ้างอยู่ backend ตอบ 409 พร้อมจำนวน แสดงในกล่องยืนยัน
 * และชี้ให้ใช้ "ปรับเป็นเลิกผลิต" แทน (ไม่ต้องเดาล่วงหน้าฝั่งเว็บว่ามีอะไรอ้างอยู่ไหม)
 *
 * field อื่น (manufacturer/supportedProtocols/warrantyMonths/
 * endOfSupportDate/notes) ยังไม่มีฟอร์มแก้ในรอบนี้ — ต้องแก้ผ่าน API ตรงๆ
 * เหมือนก่อนหน้านี้ถ้าจำเป็น (ไม่ใช่ขอบเขตที่ตกลงกันไว้ตอนแรก)
 */
export function DeviceModelRowActions({
  model,
  onUpdated,
  onDeleted,
}: {
  model: DeviceModel;
  onUpdated: (updated: DeviceModel) => void;
  /** ลบสำเร็จ — ให้หน้ารายการโหลดใหม่ (ไม่ส่ง = ไม่ทำอะไรเพิ่ม) */
  onDeleted?: () => void;
}) {
  const { session } = useAuth();
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function toggleStatus() {
    if (!session?.accessToken) return;
    const nextStatus = model.status === "active" ? "discontinued" : "active";
    setPending(true);
    try {
      const updated = await updateDeviceModel(session.accessToken, model.id, {
        status: nextStatus,
      });
      toast.success(
        nextStatus === "discontinued"
          ? `ปรับ "${model.name}" เป็นเลิกผลิตแล้ว`
          : `ปรับ "${model.name}" เป็นยังผลิตอยู่แล้ว`,
      );
      onUpdated(updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "แก้สถานะไม่สำเร็จ";
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(): Promise<boolean> {
    if (!session?.accessToken) return false;
    setDeleteError(null);
    try {
      await deleteDeviceModel(session.accessToken, model.id);
      toast.success(`ลบรุ่น "${model.name}" แล้ว`);
      onDeleted?.();
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "ลบรุ่นไม่สำเร็จ";
      setDeleteError(message);
      return false;
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void toggleStatus()}
      >
        {model.status === "active" ? "ปรับเป็นเลิกผลิต" : "ปรับเป็นยังผลิตอยู่"}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          setDeleteError(null);
          setDeleting(true);
        }}
      >
        <Trash2Icon /> ลบ
      </Button>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`ลบรุ่น ${model.name}?`}
        description={
          <>
            ลบจริง กู้คืนไม่ได้ ทำได้เฉพาะรุ่นที่ยังไม่มีอุปกรณ์ Config Firmware หรือพารามิเตอร์อ้างอิง
            (เช่นสร้างรุ่นผิดชื่อ) · ถ้ารุ่นนี้เคยถูกใช้งานแล้วให้ใช้ &quot;ปรับเป็นเลิกผลิต&quot; แทน
            {deleteError && (
              <span className="mt-2 block text-destructive">{deleteError}</span>
            )}
          </>
        }
        confirmLabel="ยืนยันลบ"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
