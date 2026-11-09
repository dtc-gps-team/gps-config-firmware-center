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
  rememberNote = false,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  liveEffect?: boolean;
  /** ตอนสร้าง Rollout: บอกว่าค่านี้เก็บไว้กับกลุ่มและเป็นค่าเริ่มต้นของรอบถัดไป */
  rememberNote?: boolean;
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
            ? "ถ้าส่งไม่สำเร็จ ระบบจะส่งซ้ำให้เองสูงสุด 2 ครั้ง"
            : "ถ้าส่งไม่สำเร็จ จะไม่ส่งซ้ำ"}
          {rememberNote && " ค่านี้จะถูกจำไว้ใช้กับ Rollout ครั้งถัดไป"}
          {liveEffect && " มีผลทันทีกับ Rollout ที่กำลังรันอยู่"}
        </p>
      </div>
    </div>
  );
}
