import { cn } from "@/lib/utils"

/** skeleton ที่มีแถบ shimmer เลื่อนผ่าน (transform ล้วน) — ปิดเองเมื่อผู้ใช้
 *  ตั้ง prefers-reduced-motion (ดู globals.css) */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-foreground/[0.06] after:to-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
