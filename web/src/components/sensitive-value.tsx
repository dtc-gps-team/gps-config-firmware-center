"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Input ที่ mask ค่าเป็น default (`type="password"`) พร้อมปุ่ม toggle แสดง/ซ่อน
 * — ใช้กับช่องกรอกค่าของ field ที่ `ConfigFieldDefinition.sensitive === true`
 * (issue #200) mirror ปุ่ม show/hide ของ `login-form.tsx`
 *
 * ไม่มี permission เพิ่มเติมสำหรับปุ่ม toggle — `sensitive` เป็นแค่ flag การ
 * แสดงผล ไม่ใช่การเข้ารหัส (ตาม #200) ค่าจริงอยู่ใน response ที่ browser ได้รับ
 * แล้วเสมอ RBAC ที่คุมจริงคือสิทธิ์เข้าหน้า/component นี้ตั้งแต่ต้น (เช่น
 * ConfigEngineer เท่านั้นเห็นฟอร์มนี้) ไม่ใช่ปุ่ม show/hide เอง
 */
export function SensitiveInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className={cn("pr-9", className)}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "ซ่อนค่า" : "แสดงค่า"}
        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? (
          <EyeOffIcon className="size-3.5" />
        ) : (
          <EyeIcon className="size-3.5" />
        )}
      </button>
    </div>
  );
}

/**
 * แสดงค่าที่ mask เป็น `••••••••` ตาม default พร้อมปุ่ม toggle ดูค่าจริง — ใช้
 * แสดงผล (ไม่ใช่กรอก) เช่น config detail view / JSON preview / override panel
 * ค่าว่าง (`""`/`null`-like) ไม่ต้อง mask เพราะไม่มีอะไรให้ดู
 */
export function SensitiveValue({ value }: { value: string }) {
  const [show, setShow] = useState(false);
  if (!value) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs">{show ? value : "••••••••"}</span>
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "ซ่อนค่า" : "แสดงค่า"}
        className="text-muted-foreground hover:text-foreground"
      >
        {show ? (
          <EyeOffIcon className="size-3.5" />
        ) : (
          <EyeIcon className="size-3.5" />
        )}
      </button>
    </span>
  );
}
