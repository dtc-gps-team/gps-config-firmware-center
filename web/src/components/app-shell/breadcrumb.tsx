"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { findActiveNavItem, visibleNavItems } from "@/lib/nav";

export type Crumb = { label: string; href?: string };

/**
 * breadcrumb บนแถบบน = เมนูที่ครอบหน้าปัจจุบัน (หาจาก NAV_ITEMS เหมือนที่
 * sidebar ใช้ highlight) + ส่วนต่อท้ายที่หน้าเองส่งมา (เช่นชื่อ Config ในหน้า
 * รายละเอียด) ผ่าน `PageHeader breadcrumb={...}`
 *
 * ส่วนต่อท้ายต้องมาจากหน้า เพราะ shell ไม่รู้ชื่อ record ที่หน้ากำลังโหลด —
 * ใช้ context แทนการให้ทุกหน้า render breadcrumb เอง ตำแหน่งจะได้อยู่ที่เดิม
 * ทุกหน้า
 */
const BreadcrumbTrailContext = createContext<
  ((trail: Crumb[]) => void) | null
>(null);
const BreadcrumbValueContext = createContext<Crumb[]>([]);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [trail, setTrail] = useState<Crumb[]>([]);
  return (
    <BreadcrumbTrailContext.Provider value={setTrail}>
      <BreadcrumbValueContext.Provider value={trail}>
        {children}
      </BreadcrumbValueContext.Provider>
    </BreadcrumbTrailContext.Provider>
  );
}

/** ตั้งส่วนต่อท้ายของ breadcrumb ระหว่างที่ component นี้ยัง mount อยู่ —
 *  ใช้นอก provider (เช่นใน test) ได้ เป็น no-op */
export function useBreadcrumbTrail(trail: Crumb[] | undefined) {
  const setTrail = useContext(BreadcrumbTrailContext);
  // เทียบด้วยค่า (ไม่ใช่ reference) กัน effect วนเพราะหน้าส่ง array ใหม่ทุก render
  const key = JSON.stringify(trail ?? []);
  useEffect(() => {
    if (!setTrail) return;
    setTrail(JSON.parse(key) as Crumb[]);
    return () => setTrail([]);
  }, [setTrail, key]);
}

export function HeaderBreadcrumb() {
  const pathname = usePathname();
  const { session } = useAuth();
  const trail = useContext(BreadcrumbValueContext);

  const crumbs = useMemo<Crumb[]>(() => {
    const section = findActiveNavItem(visibleNavItems(session?.role), pathname);
    const base: Crumb[] = section
      ? [{ label: section.label, href: section.href }]
      : [];
    return [...base, ...trail];
  }, [pathname, session?.role, trail]);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}-${crumb.label}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/60"
                />
              )}
              {last || !crumb.href ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={
                    last
                      ? "truncate font-semibold text-foreground"
                      : "truncate text-muted-foreground"
                  }
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
