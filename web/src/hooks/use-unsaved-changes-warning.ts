"use client";

import { useEffect } from "react";

/**
 * เตือนก่อนออกจากหน้าถ้ามีข้อมูลที่ยังไม่บันทึก (`isDirty`) — ใช้กับ wizard
 * หลายขั้นตอน (Config/Campaign) ที่เดิมไม่มีการเตือนเลยแม้กรอกมาหลาย step
 * แล้ว ครอบคลุม 2 ทาง:
 *
 * 1. refresh / ปิดแท็บ / ปุ่ม back ของ browser — ผ่าน `beforeunload` (เตือน
 *    อัตโนมัติ ข้อความเป็นของ browser เอง กำหนดเองไม่ได้ตาม spec)
 * 2. การนำทางภายในแอป (ปุ่ม "ยกเลิก" / "กลับไปรายการ") — ต้องเรียก
 *    `confirmLeave()` เองก่อน `router.push` เพราะ Next.js App Router
 *    ไม่มี hook ดัก client-side navigation แบบ built-in
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Chrome รุ่นเก่าต้องตั้ง returnValue ด้วยถึงจะโชว์ prompt (ข้อความจริง
      // ที่โชว์เป็นของ browser เอง ค่าที่ตั้งไม่มีผล)
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  /** เรียกก่อนนำทางออกจากหน้าเอง (Cancel/กลับไปรายการ) — คืน `true` ถ้าไปต่อ
   * ได้ (ไม่ dirty หรือผู้ใช้กดยืนยันออกแล้ว) */
  function confirmLeave(): boolean {
    if (!isDirty) return true;
    return window.confirm("มีข้อมูลที่ยังไม่บันทึก ออกจากหน้านี้เลยไหม?");
  }

  return { confirmLeave };
}
