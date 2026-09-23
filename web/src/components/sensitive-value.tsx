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

/** string โชว์ตรงๆ ค่าอื่น (number/boolean/object/array) แปลงเป็น JSON —
 * mirror `renderFieldValue`/`fieldValueText` (config-detail-view.tsx /
 * approval-card.tsx) — เก็บไว้ในไฟล์นี้เพื่อให้ตัว component คุม format เอง
 * แทนที่จะพึ่งผู้เรียกแปลงมาก่อน (ดูเหตุผลที่ `value` รับ `unknown` ด้านล่าง) */
function formatSensitiveValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/**
 * แสดงค่าที่ mask เป็น `••••••••` ตาม default พร้อมปุ่ม toggle ดูค่าจริง — ใช้
 * แสดงผล (ไม่ใช่กรอก) เช่น config detail view / JSON preview / override panel
 * ค่าว่าง (`""`/`null`/`undefined`) ไม่ต้อง mask เพราะไม่มีอะไรให้ดู
 *
 * รับ `value: unknown` (ค่าดิบ ก่อนแปลงเป็น placeholder ใดๆ) โดยตั้งใจ — ไม่ใช่
 * string ที่ format มาแล้ว เพราะผู้เรียกบางจุดแปลง `null`/`undefined` เป็น
 * placeholder `"-"` ก่อนส่งเข้ามา (เช่น `renderFieldValue`) ซึ่งเป็น truthy
 * string ทำให้ component คิดว่ามีค่าจริงต้อง mask ทั้งที่จริงๆ ไม่มีอะไรให้ดู
 * เลย — เช็ค emptiness จากค่าดิบก่อนเสมอ แล้วค่อย format เองด้านใน */
export function SensitiveValue({ value }: { value: unknown }) {
  const [show, setShow] = useState(false);
  const isEmpty = value === null || value === undefined || value === "";
  if (isEmpty) {
    return <span className="text-muted-foreground">—</span>;
  }
  const display = formatSensitiveValue(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs whitespace-pre-wrap break-words">
        {show ? display : "••••••••"}
      </span>
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
