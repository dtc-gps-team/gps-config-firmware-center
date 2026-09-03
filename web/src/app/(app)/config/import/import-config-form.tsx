"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * ฟอร์ม Import Config จากไฟล์ JSON — SW เท่านั้น (RBAC_Matrix.md Section 2
 * แถว Config Import) role อื่นไม่มีสิทธิ์นำเข้าเลย เห็นข้อความแทนฟอร์ม
 *
 * ฟอร์มเป็น scaffold `disabled` อยู่แล้ว รอต่อ POST /config/import จริง —
 * component นี้คุมแค่ว่า "ควรเห็นฟอร์มนี้ไหม" (UX-level gate เท่านั้น การ
 * บังคับสิทธิ์จริงอยู่ที่ backend PermissionGuard เสมอ)
 */
export function ImportConfigForm() {
  const { session } = useAuth();

  if (!canCreateConfig(session?.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        เฉพาะ Role SW เท่านั้นที่นำเข้า Config ได้
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="config-file">ไฟล์ Config</Label>
        <Input id="config-file" type="file" accept=".json" disabled />
      </div>
      <Button disabled>นำเข้า</Button>
    </div>
  );
}
