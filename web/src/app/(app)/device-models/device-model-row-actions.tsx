"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { updateDeviceModel, type DeviceModel } from "@/lib/device-model-api";
import { Button } from "@/components/ui/button";

/**
 * ปุ่มเดียว: สลับ active/discontinued — Admin/SuperAdmin เท่านั้นที่เห็นหน้า
 * นี้อยู่แล้ว (gate ที่ `device-model-management-view.tsx`) เรียก
 * `PATCH /device-models/{id}` ทันทีตอนกด (ไม่มีปุ่ม "บันทึก" แยก mirror
 * `UserRowActions.toggleActive`) — ไม่มี hard delete ในระบบนี้ (ชื่อรุ่นอาจ
 * ถูกอ้างอิงอยู่ใน Device/Config/Firmware เดิมอยู่แล้ว)
 *
 * field อื่น (manufacturer/supportedProtocols/warrantyMonths/
 * endOfSupportDate/notes) ยังไม่มีฟอร์มแก้ในรอบนี้ — ต้องแก้ผ่าน API ตรงๆ
 * เหมือนก่อนหน้านี้ถ้าจำเป็น (ไม่ใช่ขอบเขตที่ตกลงกันไว้ตอนแรก)
 */
export function DeviceModelRowActions({
  model,
  onUpdated,
}: {
  model: DeviceModel;
  onUpdated: (updated: DeviceModel) => void;
}) {
  const { session } = useAuth();
  const [pending, setPending] = useState(false);

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
    </div>
  );
}
