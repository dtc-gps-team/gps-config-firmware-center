"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { canCreateConfig } from "@/lib/permissions";
import { type Config } from "@/lib/config-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ImportConfigForm } from "./import-config-form";

/**
 * ปุ่ม "Import จากไฟล์" ในหน้า Config Editor — ConfigEngineer เท่านั้น (RBAC_Matrix.md
 * Section 2 แถว Config Import) role อื่นไม่เห็นปุ่มนี้
 *
 * เดิมพาไปหน้าเต็ม `/config/import` — ย้ายมาเป็น Dialog (แก้ครั้งที่ 71 —
 * เดิม comment บอกว่า "ทำเป็นหน้าเต็มแทน Dialog เพราะต้องมีที่โชว์ preview +
 * รายการ error" ซึ่ง Dialog ใหม่รองรับ scroll ภายในแล้ว) — เป็น UX-level
 * gate เท่านั้น backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function ImportConfigButton({
  onImported,
}: {
  onImported: (config: Config) => void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);

  if (!canCreateConfig(session?.role)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        Import จากไฟล์
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>นำเข้า Config จากไฟล์ JSON</DialogTitle>
          <DialogDescription>
            ไฟล์ที่นำเข้าจะกลายเป็น Config สถานะ draft ต้องทดสอบและให้
            Operation อนุมัติเหมือนสร้างผ่านฟอร์ม
          </DialogDescription>
        </DialogHeader>
        <ImportConfigForm
          onImported={(config) => {
            setOpen(false);
            onImported(config);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
