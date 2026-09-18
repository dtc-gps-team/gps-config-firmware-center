"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  MANAGEABLE_ROLE_CODES,
  updateUser,
  type ManagedUser,
} from "@/lib/users-api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * แถวละ 1 ชุด: dropdown เปลี่ยน role + ปุ่มเปิด/ปิดการใช้งาน — Admin เท่านั้น
 * ที่เห็นหน้านี้อยู่แล้ว (gate ทั้งหน้าที่ `user-management-view.tsx`) เรียก
 * `PATCH /users/{id}` ทันทีตอนเปลี่ยน (ไม่มีปุ่ม "บันทึก" แยก — mirror
 * `EditCompatibilityForm` ที่ auto-submit ทันทีเหมือนกัน)
 */
export function UserRowActions({
  user,
  onUpdated,
}: {
  user: ManagedUser;
  onUpdated: (updated: ManagedUser) => void;
}) {
  const { session } = useAuth();
  const [pending, setPending] = useState(false);

  async function changeRole(role: string | null) {
    if (!role || !session?.accessToken || role === user.role) return;
    setPending(true);
    try {
      const updated = await updateUser(session.accessToken, user.id, {
        role,
      });
      toast.success(`เปลี่ยน role ของ "${user.username}" เป็น ${role} แล้ว`);
      onUpdated(updated);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "เปลี่ยน role ไม่สำเร็จ";
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function toggleActive() {
    if (!session?.accessToken) return;
    setPending(true);
    try {
      const updated = await updateUser(session.accessToken, user.id, {
        isActive: !user.isActive,
      });
      toast.success(
        updated.isActive
          ? `เปิดใช้งาน "${user.username}" แล้ว`
          : `ปิดใช้งาน "${user.username}" แล้ว`,
      );
      onUpdated(updated);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "แก้สถานะไม่สำเร็จ";
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Select value={user.role} onValueChange={(value) => void changeRole(value)}>
        <SelectTrigger className="h-8 w-[10rem]" disabled={pending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MANAGEABLE_ROLE_CODES.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void toggleActive()}
      >
        {user.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
      </Button>
    </div>
  );
}
