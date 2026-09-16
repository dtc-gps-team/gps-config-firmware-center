import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton ของหน้า list (DataTable หรือ table ธรรมดา) — ใช้แทนข้อความ
 * "กำลังโหลด…" เดิมระหว่างรอ fetch ครั้งแรก จำลองโครงตาราง (border/หัวตาราง/
 * แถว) ให้ใกล้เคียงตารางจริงที่จะโผล่มาแทนที่ เพื่อลด layout jump ตอนโหลดเสร็จ
 *
 * ส่ง `columns` ตรงจากความยาว column def จริงของแต่ละหน้า (เช่น
 * `columns.length`) เพื่อให้จำนวนคอลัมน์ skeleton ตรงกับตารางจริงเป๊ะ
 */
export function TableSkeleton({
  columns = 4,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: columns }).map((_, i) => (
                <TableHead key={i}>
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, r) => (
              <TableRow key={r}>
                {Array.from({ length: columns }).map((_, c) => (
                  <TableCell key={c}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
