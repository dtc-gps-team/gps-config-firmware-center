"use client";

import { cn } from "@/lib/utils";
import { type Crumb, useBreadcrumbTrail } from "@/components/app-shell/breadcrumb";

/**
 * หัวหน้าจอมาตรฐาน (UI ปรับใหม่ 2026-10) — เดิมแต่ละหน้าเขียน `<h1>` เองมี
 * 3 แบบ ปุ่ม action บางหน้าอยู่หัวหน้า บางหน้าอยู่ในการ์ด ใช้ component นี้
 * แทนให้ทุกหน้าหน้าตาและตำแหน่งปุ่มเหมือนกัน
 *
 * - `description` บอกว่าหน้านี้ใช้ทำอะไร **ไม่ใช่เรื่องสิทธิ์** ("สร้างได้
 *   เฉพาะ Role ..." ไม่ต้องเขียน) ปุ่มที่ Role ทำไม่ได้เลยให้ซ่อน ปุ่มที่ติด
 *   เงื่อนไขชั่วคราวให้ disable พร้อม tooltip บอกเหตุผลแทน
 * - `status` ป้ายสถานะข้างชื่อ (หน้ารายละเอียด)
 * - `meta` แถวข้อมูลสั้นใต้ชื่อ (โมเดล, เวอร์ชัน, เวลาแก้ไข) ใช้ `<PageHeaderMeta>`
 * - `actions` ปุ่มชิดขวาเสมอ ปุ่มหลักวางไว้ท้ายสุด
 * - `breadcrumb` ส่วนต่อท้ายของ breadcrumb บนแถบบน (เช่นชื่อ record) — ส่วน
 *   หัว (ชื่อเมนู) shell ใส่ให้เองแล้ว
 */
export function PageHeader({
  title,
  description,
  status,
  meta,
  actions,
  breadcrumb,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  status?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: Crumb[];
  className?: string;
}) {
  useBreadcrumbTrail(breadcrumb);

  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">
            {title}
          </h1>
          {status}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {meta}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** แถวข้อมูลสั้นใต้ชื่อหน้า — คู่ "ชื่อสีเทา ค่าสีเข้ม" ไม่ใช้ไอคอนตกแต่ง */
export function PageHeaderMeta({
  items,
}: {
  items: { label: string; value: React.ReactNode }[];
}) {
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      {items.map((item) => (
        <div key={item.label} className="flex gap-1.5">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
