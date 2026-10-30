"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canAccessUserManagement } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  createUser,
  rolesManageableBy,
  type ManagedUser,
} from "@/lib/users-api";
import { FormBody, FormFooter, FormSection } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * ฟอร์มสร้างบัญชีทั่วไปใหม่ — Admin/SuperAdmin เท่านั้น (RBAC_Matrix.md ตาราง
 * 4.1 `POST /users`) role อื่นเห็นข้อความแทนฟอร์ม · dropdown role ขึ้นกับ
 * viewer (`rolesManageableBy`) — Admin ธรรมดาเห็นแค่บัญชีทั่วไป SuperAdmin
 * เห็น Admin/SuperAdmin เพิ่มด้วย (มติ 2026-10-30) — กันทั้งฝั่ง UI (ไม่โชว์)
 * และฝั่ง backend (validate ปฏิเสธซ้ำ)
 *
 * เดิมเป็นหน้าเต็ม `/users/new` — ย้ายมาเป็น Dialog (แก้ครั้งที่ 71) เพราะ
 * เนื้อหาสั้นจบในตัว ไม่มี preview/error list ที่ต้องการพื้นที่เยอะ · เรียก
 * `onCreated` แทน `router.push` เดิม ให้ parent ปิด dialog + refetch เอง
 *
 * gate นี้เป็น UX-level เท่านั้น — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function CreateUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: (user: ManagedUser) => void;
  onCancel?: () => void;
}) {
  const { session } = useAuth();
  const roles = rolesManageableBy(session?.role);

  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>(roles[0]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!canAccessUserManagement(session?.role)) {
    return (
      <p className="px-6 py-5 text-sm text-muted-foreground">
        เฉพาะ Role Admin เท่านั้นที่เพิ่มผู้ใช้ได้
      </p>
    );
  }

  async function onSubmit() {
    if (!session?.accessToken) return;
    const trimmedUsername = username.trim();
    const trimmedFullName = fullName.trim();
    if (!trimmedUsername) {
      setFormError("ต้องระบุ username");
      return;
    }
    if (!trimmedFullName) {
      setFormError("ต้องระบุชื่อเต็ม");
      return;
    }
    if (password.length < 8) {
      setFormError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createUser(session.accessToken, {
        username: trimmedUsername,
        fullName: trimmedFullName,
        password,
        role,
      });
      toast.success(`เพิ่มผู้ใช้ "${created.username}" แล้ว`);
      onCreated(created);
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError ? err.message : "เพิ่มผู้ใช้ไม่สำเร็จ";
      setFormError(message);
      toast.error(message);
    }
  }

  const canSubmit =
    username.trim() !== "" &&
    fullName.trim() !== "" &&
    password.length >= 8 &&
    !submitting;

  return (
    <div className="flex flex-col">
      <FormBody>
        <FormSection title="ข้อมูลบัญชี">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-username">Username</Label>
              <Input
                id="user-username"
                value={username}
                disabled={submitting}
                placeholder="เช่น config2.test"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-fullname">ชื่อเต็ม</Label>
              <Input
                id="user-fullname"
                value={fullName}
                disabled={submitting}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="สิทธิ์และการเข้าสู่ระบบ">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value ?? roles[0])}
              >
                <SelectTrigger className="w-full" disabled={submitting}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="user-password">รหัสผ่านเริ่มต้น</Label>
              <Input
                id="user-password"
                type="text"
                value={password}
                disabled={submitting}
                placeholder="อย่างน้อย 8 ตัวอักษร"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            แจ้งรหัสผ่านนี้ให้ผู้ใช้เอง ระบบยังไม่มีอีเมล/flow ลืมรหัสผ่าน
          </p>
        </FormSection>

        {formError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {formError}
          </div>
        )}
      </FormBody>

      <FormFooter onCancel={onCancel} submitting={submitting}>
        <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
          {submitting ? "กำลังเพิ่ม…" : "เพิ่มผู้ใช้"}
        </Button>
      </FormFooter>
    </div>
  );
}
