import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * หน้าแจ้งสถานะเต็มพื้นที่เนื้อหา ใช้ร่วมกันระหว่าง 404, ข้อผิดพลาดของระบบ และไม่มีสิทธิ์
 * `code` เป็นรหัสสั้นแบบเครื่องวัด (404, 403, 500) ตัวแรกที่สายตาเห็น แล้วตามด้วยสิ่งที่เกิดขึ้น
 * และขั้นต่อไปใน `actions` · ข้อความอธิบายสั้น บอกทางออก ไม่ขอโทษซ้ำ
 */
export function StatusPage({
  icon: Icon,
  code,
  title,
  description,
  actions,
  className,
}: {
  icon: LucideIcon;
  code: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-[60vh] items-center justify-center p-4",
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Icon className="size-8 text-muted-foreground/50" />
        <p className="font-instrument text-4xl font-semibold tracking-tight text-muted-foreground/70 tabular-nums">
          {code}
        </p>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {actions && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
