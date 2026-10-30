"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NAV_GROUPS, findActiveNavItem, visibleNavItems } from "@/lib/nav";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { NAV_BADGES } from "./nav-badges";

/**
 * เมนูหลัก — `collapsed` = แสดงเฉพาะไอคอน (ชื่ออยู่ใน tooltip) · ตัวชี้เมนูที่
 * active เลื่อนตามด้วย layout animation (`layoutId`) · `scope` แยก LayoutGroup
 * ของ sidebar บนจอใหญ่กับ Sheet บนมือถือ ไม่ให้ตัวชี้ของสองชุดปนกัน
 */
export function NavLinks({
  onNavigate,
  collapsed = false,
  scope = "desktop",
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  scope?: string;
}) {
  const pathname = usePathname();
  const { session } = useAuth();

  // เมนูที่ไม่ใส่ allowedRoles ไว้ = ทุก Role เห็นได้ (ส่วนใหญ่ของหน้าปัจจุบัน
  // ทุก Role มีอย่างน้อย R ตาม RBAC_Matrix.md Section 2) กรองเฉพาะหน้าที่ระบุ
  // allowedRoles ไว้ชัดเจน (Audit Log, User Management)
  const visibleItems = visibleNavItems(session?.role);
  const activeHref = findActiveNavItem(visibleItems, pathname)?.href ?? null;

  return (
    <LayoutGroup id={`nav-${scope}`}>
      <nav aria-label="เมนูหลัก" className="flex flex-col gap-4">
        {NAV_GROUPS.map((group) => {
          const items = visibleItems.filter((item) => item.group === group.id);
          // กลุ่มที่ Role นี้ไม่เห็นเมนูไหนเลย (เช่น "ระบบ" ของ ConfigEngineer)
          // ไม่ต้องแสดงหัวกลุ่มลอยๆ
          if (items.length === 0) return null;
          return (
            <div key={group.id} className="flex flex-col gap-0.5">
              {collapsed ? (
                <div
                  aria-hidden="true"
                  className="mx-3 mb-1 h-px bg-sidebar-border"
                />
              ) : (
                <p className="label-caps px-3 pb-1 text-sidebar-foreground/60">
                  {group.label}
                </p>
              )}
              {items.map((item) => {
                const active = item.href === activeHref;
                const Badge = NAV_BADGES[item.href];
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex h-9 items-center gap-2.5 rounded-md px-3 text-sm outline-none transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      collapsed && "justify-center px-0",
                      active
                        ? "font-semibold text-sidebar-primary-foreground"
                        : "font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        transition={spring}
                        aria-hidden="true"
                        className="absolute inset-0 rounded-md bg-sidebar-primary"
                      />
                    )}
                    <item.icon className="relative size-4 shrink-0" />
                    {!collapsed && (
                      <span className="relative min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                    )}
                    {Badge && (
                      <span
                        className={collapsed ? "contents" : "relative ml-auto flex"}
                      >
                        <Badge compact={collapsed} />
                      </span>
                    )}
                  </Link>
                );
                return collapsed ? (
                  <Tooltip key={item.href}>
                    <TooltipTrigger render={link} />
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={item.href}>{link}</div>
                );
              })}
            </div>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
