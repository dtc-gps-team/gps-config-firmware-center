"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session } = useAuth();

  // เมนูที่ไม่ใส่ allowedRoles ไว้ = ทุก Role เห็นได้ (ส่วนใหญ่ของหน้าปัจจุบัน
  // ทุก Role มีอย่างน้อย R ตาม RBAC_Matrix.md Section 2) กรองเฉพาะหน้าที่ระบุ
  // allowedRoles ไว้ชัดเจน (Audit Log, User Management)
  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      !item.allowedRoles ||
      item.allowedRoles.some((role) => role === session?.role),
  );

  // เมนูไหน "ครอบ" หน้าปัจจุบัน — match ที่ขอบ segment (ไม่ใช่ prefix เปล่าๆ ที่
  // ทำให้ /config ติด active ค้างตอนอยู่ /config/import) แล้วเลือกอันที่เจาะจง
  // ที่สุด (href ยาวสุด) เพื่อให้ /devices/:id ยัง highlight "Device Search" อยู่
  const activeHref = visibleItems
    .filter((item) =>
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .reduce<string | null>(
      (best, item) =>
        best === null || item.href.length > best.length ? item.href : best,
      null,
    );

  return (
    <nav className="flex flex-col gap-1">
      {visibleItems.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
