import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * กล่องข้อความแจ้งในหน้า (บันทึกสำเร็จ, คำเตือน, ข้อมูลประกอบ) — ใช้แทนกล่อง
 * ที่เขียนสีเอง (`border-emerald-200 bg-emerald-50 ...`) ซ้ำหลายหน้าเดิม สีมา
 * จาก semantic token ชุดเดียวกับ `Badge` จึงเข้ากับ dark mode เอง
 *
 * `onDismiss` ใส่เมื่อผู้ใช้ปิดเองได้ (เช่นแจ้ง "บันทึกแล้ว")
 */
export type NoticeTone = "success" | "warning" | "danger" | "info" | "neutral"

const TONE_CLASS: Record<NoticeTone, string> = {
  success: "border-success/30 bg-success-subtle text-success-foreground",
  warning: "border-warning/30 bg-warning-subtle text-warning-foreground",
  danger: "border-destructive/30 bg-danger-subtle text-danger-foreground",
  info: "border-info/30 bg-info-subtle text-info-foreground",
  neutral: "border-border bg-secondary text-secondary-foreground",
}

function Notice({
  tone = "info",
  onDismiss,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  tone?: NoticeTone
  onDismiss?: () => void
}) {
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm",
        TONE_CLASS[tone],
        className
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="ปิด"
          className="-mr-1 shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  )
}

export { Notice }
