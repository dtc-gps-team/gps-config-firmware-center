"use client";

import Link from "next/link";

import { useConfig } from "@/hooks/use-config";

/**
 * ลิงก์ "โคลนจาก" ไปหน้ารายละเอียดของ Config ต้นทาง — ส่วนแสดงผลล้วน
 * (`unavailable` = เปิดต้นทางไม่ได้ เช่นถูกลบ แสดงเป็นข้อความ ไม่ลิงก์)
 */
export function CloneSourceLink({
  sourceId,
  sourceName,
  unavailable = false,
}: {
  sourceId: string;
  sourceName: string | null;
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <span className="text-muted-foreground">
        Config ต้นทาง (เปิดไม่ได้ อาจถูกลบแล้ว)
      </span>
    );
  }
  return (
    <Link
      href={`/config/${encodeURIComponent(sourceId)}`}
      className="underline-offset-2 hover:underline"
    >
      {sourceName ?? "Config ต้นทาง"}
    </Link>
  );
}

/**
 * ตัวที่โหลดชื่อต้นทางเอง — ใช้ในหน้าที่ยังไม่ได้โหลด Config ต้นทางอยู่แล้ว
 * (หน้ารายละเอียด Config) หน้าอนุมัติโหลดต้นทางเองเพื่อเทียบค่าอยู่แล้ว
 * จึงใช้ `CloneSourceLink` ตรงๆ ไม่ยิงซ้ำ
 */
export function CloneSourceLinkLoader({ sourceId }: { sourceId: string }) {
  const { data, error } = useConfig(sourceId);
  return (
    <CloneSourceLink
      sourceId={sourceId}
      sourceName={data?.name ?? null}
      unavailable={error !== null && data === null}
    />
  );
}
