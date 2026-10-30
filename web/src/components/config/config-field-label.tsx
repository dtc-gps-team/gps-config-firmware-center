import { cn } from "@/lib/utils";

/**
 * ป้ายชื่อ field 1 ตัวในจุดที่แสดง/กรอก**ค่า**พารามิเตอร์ (Config Detail,
 * Config Wizard, Config Override ฯลฯ) — คำอธิบายจาก Parameter Library (ถ้ามี)
 * เป็นหัวหลัก ชื่อ field จริง (ศัพท์เฉพาะ เช่น `data_server.host`) อยู่ใต้แบบ
 * mono เล็ก (รีวิวพี่เลี้ยง — ตั้งใจสลับจากหน้าคลัง Parameter เองที่ fieldName
 * ขึ้นก่อนแล้วคำอธิบายอยู่ล่าง เพราะที่นี่ผู้ใช้ส่วนใหญ่อยากรู้ "ค่านี้คืออะไร"
 * ก่อน ไม่ใช่ชื่อตัวแปรดิบ — mirror layout เดียวกับ Mobile `_FieldRow`
 * (config_override_page.dart, PR #400)
 *
 * **ขนาดตัวอักษรกำหนดเองในนี้เสมอ ไม่รับ text-size/color จาก `className` ของ
 * ผู้เรียก** — `className` ใช้แค่ layout (shrink-0, truncate ฯลฯ) เพราะแต่ละ
 * branch (มี/ไม่มีคำอธิบาย) ต้องการโทนต่างกัน: ไม่มีคำอธิบาย = fieldName
 * เดี่ยวๆ (เทาเล็ก เหมือนเดิมทุกจุดที่เคยเรียก), มีคำอธิบาย = คำอธิบายเป็นหัว
 * (สีปกติ) fieldName ลงมาเป็นรองเสมอ
 */
export function ConfigFieldLabel({
  fieldName,
  description,
  className,
}: {
  fieldName: string;
  description?: string | null;
  className?: string;
}) {
  const label = description?.trim();
  if (!label) {
    return (
      <span className={cn("font-mono text-xs text-muted-foreground", className)}>
        {fieldName}
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span className="text-foreground">{label}</span>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {fieldName}
      </span>
    </span>
  );
}
