/**
 * แถว label/value ใช้ร่วมกันในหน้ารายละเอียด (Config/Firmware/Campaign
 * detail view) — เดิม implement ซ้ำเหมือนกันเป๊ะ 3 ที่แยกกัน
 */
export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right break-words">{children}</span>
    </div>
  );
}
