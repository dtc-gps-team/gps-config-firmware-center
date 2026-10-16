"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * ครอบปุ่มที่ถูก disable ชั่วคราว ให้เอาเมาส์ชี้หรือกด Tab มาแล้วเห็นเหตุผล
 * (UI ปรับใหม่ 2026-10) — กติกาของระบบ:
 * - Role ที่ไม่มีวันทำ action นั้นได้ → **ซ่อนปุ่ม** (ไม่ต้องใช้ component นี้)
 * - Role ที่ปกติทำได้ แต่ติดเงื่อนไขตอนนี้ (Separation of Duty, สถานะยังไม่
 *   พร้อม) → **แสดงปุ่ม disable + เหตุผล** ด้วย component นี้ ผู้ใช้คาดว่า
 *   จะกดได้ ถ้าซ่อนไปเฉยๆ จะงงว่าปุ่มหายไปไหน
 *
 * ปุ่มที่ disable รับ event เมาส์ไม่ได้ เลยต้องมี span ครอบเป็นตัวเปิด tooltip
 * และให้ span รับ focus ได้แทน · เหตุผลอยู่ใน sr-only ด้วย เพราะ tooltip
 * ไม่ขึ้นบนจอสัมผัส และ screen reader ต้องอ่านได้
 */
export function DisabledWithReason({
  reason,
  children,
}: {
  reason: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex cursor-not-allowed rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {children}
        <span className="sr-only">{reason}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
