import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** สถานะ error ของพื้นที่หนึ่งในหน้า: บอกสาเหตุ + ปุ่มลองใหม่
 *  ข้อความสาเหตุมาจากผู้เรียก (ข้อความของ API) ไม่เขียนทับ */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 rounded-lg border border-destructive/30 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground",
        className,
      )}
    >
      <TriangleAlertIcon className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          ลองใหม่
        </Button>
      )}
    </div>
  );
}
