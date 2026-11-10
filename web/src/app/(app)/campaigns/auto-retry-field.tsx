"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAutoRetryMaxAttempts } from "@/hooks/use-auto-retry-max-attempts";

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
  disabledNote,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  liveEffect?: boolean;
  /** ตอนสร้าง Rollout: บอกว่าค่านี้เก็บไว้กับกลุ่มและเป็นค่าเริ่มต้นของรอบถัดไป */
  rememberNote?: boolean;
  /** มีค่า = ล็อกช่องไว้ แล้วแสดงข้อความนี้แทนคำอธิบาย (เช่น โหลดการตั้งค่าของกลุ่มไม่สำเร็จ) */
  disabledNote?: string;
}) {
  // ส่งซ้ำได้อีกกี่ครั้ง = จำนวนครั้งสูงสุด (รวมครั้งแรก) ลบ 1
  const retries = useAutoRetryMaxAttempts() - 1;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabledNote !== undefined}
        onCheckedChange={(c) => onChange(c === true)}
        className="mt-0.5 size-5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>ลองส่งใหม่อัตโนมัติเมื่อส่งไม่สำเร็จ</Label>
        {disabledNote !== undefined ? (
          <p className="text-xs text-destructive">{disabledNote}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {checked && retries > 0
              ? `ถ้าส่งไม่สำเร็จ ระบบจะส่งซ้ำให้เองสูงสุด ${retries} ครั้ง`
              : "ถ้าส่งไม่สำเร็จ จะไม่ส่งซ้ำ"}
            {rememberNote && " ค่านี้จะถูกจำไว้ใช้กับ Rollout ครั้งถัดไป"}
            {liveEffect && " มีผลทันทีกับ Rollout ที่กำลังรันอยู่"}
          </p>
        )}
      </div>
    </div>
  );
}
