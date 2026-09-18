import type { LucideIcon } from "lucide-react";

/**
 * แถว label/value ใช้ร่วมกันในหน้ารายละเอียด (Config/Firmware/Campaign
 * detail view) — เดิม implement ซ้ำเหมือนกันเป๊ะ 3 ที่แยกกัน
 *
 * `icon` (ไม่บังคับ) — icon เล็กๆ หน้า label ช่วยให้ scan รายการยาวๆ ง่ายขึ้น
 * (เดิมเป็น label:value แบนราบล้วน ไม่มีจุดสังเกตทางสายตาเลย)
 */
export function InfoRow({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="size-3.5 shrink-0" />}
        {label}
      </span>
      <span className="text-right break-words">{children}</span>
    </div>
  );
}
