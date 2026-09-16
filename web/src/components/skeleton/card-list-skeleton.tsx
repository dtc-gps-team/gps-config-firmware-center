import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton ของรายการแบบการ์ด (เช่น Approval Center ที่ไม่ได้ใช้ DataTable) —
 * จำลองการ์ดว่างหลายใบระหว่างรอ fetch ครั้งแรก แทนข้อความ "กำลังโหลด…" เดิม
 */
export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-4">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
