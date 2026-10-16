"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { NAV_GROUPS, findActiveNavItem, visibleNavItems } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session } = useAuth();

  // เมนูที่ไม่ใส่ allowedRoles ไว้ = ทุก Role เห็นได้ (ส่วนใหญ่ของหน้าปัจจุบัน
  // ทุก Role มีอย่างน้อย R ตาม RBAC_Matrix.md Section 2) กรองเฉพาะหน้าที่ระบุ
  // allowedRoles ไว้ชัดเจน (Audit Log, User Management)
  const visibleItems = visibleNavItems(session?.role);
  const activeHref = findActiveNavItem(visibleItems, pathname)?.href ?? null;

  return (
    <nav aria-label="เมนูหลัก" className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => {
        const items = visibleItems.filter((item) => item.group === group.id);
        // กลุ่มที่ Role นี้ไม่เห็นเมนูไหนเลย (เช่น "ระบบ" ของ ConfigEngineer)
        // ไม่ต้องแสดงหัวกลุ่มลอยๆ
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-xs font-semibold text-sidebar-foreground/55">
              {group.label}
            </p>
            {items.map((item) => {
              const active = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors",
                    active
                      ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                      : "font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
