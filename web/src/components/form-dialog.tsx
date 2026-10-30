import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * ชิ้นส่วนกลางของ Dialog ฟอร์ม (เพิ่มผู้ใช้, เพิ่มโมเดล ฯลฯ): หัวมีไอคอน + ชื่อ + คำอธิบาย,
 * ฟอร์มแบ่งเป็นหมวดมีหัวข้อเล็ก, ท้ายเป็นแถบปุ่มพื้นเทาอ่อนแยกจากเนื้อหา · ใช้คู่กับ
 * `<DialogContent className="gap-0 p-0 sm:max-w-xl">` (ระยะขอบจัดที่ชิ้นส่วนเอง)
 */
export function FormDialogHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <DialogHeader className="flex-row items-start gap-3 border-b px-6 py-5 pr-12">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <DialogTitle className="text-lg">{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </span>
    </DialogHeader>
  );
}

/** หมวดในฟอร์ม: หัวข้อเล็ก + เส้นกำกับ แล้วตามด้วยช่องกรอก */
export function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="label-caps border-b pb-1.5 text-muted-foreground">
        {title}
      </p>
      {children}
    </section>
  );
}

/** เนื้อหาฟอร์ม (มีระยะขอบ) กับแถบปุ่มท้ายฟอร์ม */
export function FormBody({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6 px-6 py-5">{children}</div>;
}

export function FormFooter({
  onCancel,
  submitting,
  children,
}: {
  onCancel?: () => void;
  submitting?: boolean;
  /** ปุ่มยืนยันหลัก */
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-2 rounded-b-xl border-t bg-muted/40 px-6 py-4">
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={onCancel}
        >
          ยกเลิก
        </Button>
      )}
      {children}
    </div>
  );
}
