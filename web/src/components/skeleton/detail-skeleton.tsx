import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton ของหน้ารายละเอียด/ฟอร์ม/wizard — จำลองหัวข้อ + บล็อกเนื้อหาหลาย
 * บรรทัด ระหว่างรอ fetch ครั้งแรก แทนข้อความ "กำลังโหลด…" เดิม (mirror
 * `py-16` spacing ของ block ที่มันแทนที่)
 */
export function DetailSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-4 py-8">
      <Skeleton className="h-7 w-48" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
