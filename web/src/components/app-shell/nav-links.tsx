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

  return (
    <nav className="flex flex-col gap-1">
      {visibleItems.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
