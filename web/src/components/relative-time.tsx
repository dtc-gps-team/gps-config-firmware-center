"use client";

import { useEffect, useState } from "react";

import { formatDateTime, formatRelativeTime } from "@/lib/format-date";

/** เวลาสัมพัทธ์ ("3 นาทีที่แล้ว") ที่นับต่อเองทุก 30 วินาที · เอาเมาส์ชี้เห็น
 *  เวลาเต็ม · ตัวเลขชิดกัน (tabular) */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string | null | undefined;
  className?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!iso) return <span className={className}>-</span>;
  return (
    <time
      dateTime={iso}
      title={formatDateTime(iso)}
      data-tabular
      className={className}
      suppressHydrationWarning
    >
      {formatRelativeTime(iso)}
    </time>
  );
}
