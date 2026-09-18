import type { LucideIcon } from "lucide-react";

/**
 * Empty state ใช้ร่วมกันทุกหน้า list — เดิมทุกหน้าโชว์แค่ข้อความลอยๆ
 * (`<p>ยังไม่มี...</p>`) ไม่มี icon/action เลย ต่างจากหลักการทั่วไปที่ควรมี
 * icon ช่วยสื่อความหมาย + ปุ่ม action ชวนทำขั้นต่อไปถ้ามี (เช่น "สร้างใหม่")
 */
export function EmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: LucideIcon;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Icon className="size-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}
