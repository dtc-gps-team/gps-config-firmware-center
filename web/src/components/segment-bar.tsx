import { cn } from "@/lib/utils";

export type Segment = {
  key: string;
  label: string;
  value: number;
  /** คลาสสีพื้น (token เท่านั้น เช่น `bg-success`) */
  colorClass: string;
};

/**
 * แท่งสัดส่วน (part-to-whole) แนวนอน + legend ที่เป็นตารางค่าไปในตัว — ค่าที่
 * เห็นในแท่งอ่านได้จาก legend โดยไม่ต้อง hover · segment ที่เป็น 0 ไม่วาด
 * ความกว้างตามสัดส่วน, hover เห็นค่าผ่าน title
 */
export function SegmentBar({
  segments,
  className,
}: {
  segments: Segment[];
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div
        role="img"
        aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {visible.map((s) => (
          <div
            key={s.key}
            title={`${s.label} ${s.value}`}
            className={cn(
              "h-full transition-[filter] duration-(--duration-fast) hover:brightness-110",
              s.colorClass,
            )}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={cn("size-2 shrink-0 rounded-full", s.colorClass)} />
            <dt className="text-muted-foreground">{s.label}</dt>
            <dd data-tabular className="font-medium tabular-nums">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
