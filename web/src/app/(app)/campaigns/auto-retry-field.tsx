"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * ตัวเลือก "ลองส่งใหม่อัตโนมัติ" ของกลุ่ม (docs/31 §6) — ใช้ทั้งตอนสร้างและตอนแก้ไขกลุ่ม ·
 * `liveEffect` = ตอนแก้ไข: บอกว่าปิดแล้วมีผลทันทีกับ Rollout ที่กำลังรันอยู่
 */
export function AutoRetryField({
  id,
  checked,
  onChange,
  liveEffect = false,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  liveEffect?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        className="mt-0.5 size-5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>ลองส่งใหม่อัตโนมัติเมื่อส่งไม่สำเร็จ</Label>
        <p className="text-xs text-muted-foreground">
          {checked
            ? "ส่งไม่สำเร็จจะลองให้อีกสูงสุด 2 ครั้ง (รวม 3 ครั้ง) รอ 30 วินาทีแล้ว 60 วินาที"
            : "ปิดอยู่ เครื่องที่ส่งไม่สำเร็จจะนับเป็นล้มทันที ไม่ลองซ้ำ"}
          {liveEffect &&
            " · มีผลทันทีกับ Rollout ที่กำลังรันอยู่ ปิดแล้วเครื่องที่รอรอบใหม่จะจบด้วยผลรอบล่าสุด"}
        </p>
      </div>
    </div>
  );
}
