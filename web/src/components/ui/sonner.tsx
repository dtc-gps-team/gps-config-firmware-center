"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// shadcn CLI generate มาพร้อม next-themes เป็นค่าเริ่มต้น — แต่โปรเจกต์นี้ยัง
// ไม่มี ThemeProvider/ปุ่มสลับ dark mode จริง (globals.css มี token ของ .dark
// รอไว้ แต่ไม่มีจุดไหนเซ็ต class นี้เลย ดู CSS comment "Harbor Palette") เลย
// ตัด next-themes ออก ใช้ theme="light" ตรงๆ ไปก่อนให้ตรงกับสถานะจริงของแอป —
// เปลี่ยนเป็นอ่านจาก next-themes ได้ทันทีถ้าโปรเจกต์ทำ dark mode toggle จริง
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
