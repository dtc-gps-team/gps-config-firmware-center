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
            ? "ถ้าส่งไม่สำเร็จ ระบบจะลองส่งซ้ำให้อัตโนมัติอีก 2 ครั้ง (ส่งทั้งหมดไม่เกิน 3 ครั้ง) โดยรอ 30 วินาทีก่อนครั้งที่ 2 และรอ 60 วินาทีก่อนครั้งที่ 3"
            : "ไม่ลองส่งซ้ำ ถ้าส่งไม่สำเร็จจะนับว่าล้มเหลวทันที"}
          {rememberNote &&
            ". ระบบจะจำค่านี้ไว้เป็นค่าเริ่มต้นของ Rollout ครั้งถัดไป"}
          {liveEffect &&
            ". การเปลี่ยนค่านี้มีผลทันทีกับ Rollout ที่กำลังรันอยู่ ถ้าปิด เครื่องที่รอส่งซ้ำอยู่จะจบด้วยผลของครั้งล่าสุด"}
        </p>
      </div>
    </div>
  );
}
