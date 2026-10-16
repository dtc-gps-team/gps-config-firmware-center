import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * ป้ายสั้นๆ (สถานะ, จำนวน, ประเภท) — **รับสีได้แค่ tone ที่มีความหมาย** ไม่เปิด
 * ให้ส่ง className สีเองผ่าน prop แยก ตั้งใจจำกัดไว้: ระบบเดิมมีป้ายที่เขียน
 * `bg-amber-50 text-amber-700` ฯลฯ เองกระจายหลายสิบจุด แต่ละหน้าเลยโทนเพี้ยน
 * กันเล็กน้อย และป้ายหลายสีที่ไม่ได้สื่ออะไร (ประเภทงาน = สีม่วง/เขียวอมฟ้า)
 * ทำให้หน้าดูรกแบบ template สำเร็จรูป
 *
 * กติกาเลือก tone:
 * - success / warning / danger / info = สถานะที่ผู้ใช้ต้องรู้ความหมายของสี
 * - neutral = ทุกอย่างที่ไม่ใช่สถานะ (ประเภทงาน, protocol, จำนวนทั่วไป)
 *
 * `dot` ใส่จุดสีหน้าข้อความ — ใช้กับป้ายสถานะ เพื่อไม่ให้สีเป็นสิ่งเดียวที่
 * สื่อความหมาย (ข้อความยังอ่านได้แม้แยกสีไม่ออก)
 */
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info"

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-secondary text-secondary-foreground/80",
  success: "bg-success-subtle text-success-foreground",
  warning: "bg-warning-subtle text-warning-foreground",
  danger: "bg-danger-subtle text-danger-foreground",
  info: "bg-info-subtle text-info-foreground",
}

const DOT_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
}

function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "color"> & {
  tone?: BadgeTone
  dot?: boolean
}) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[tone])}
        />
      )}
      {children}
    </span>
  )
}

export { Badge }
