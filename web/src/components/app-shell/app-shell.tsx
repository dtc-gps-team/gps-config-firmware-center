"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Menu, PanelLeftCloseIcon, PanelLeftOpenIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LogoMark } from "@/components/brand/logo-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CentralConnection } from "./central-connection";
import { CommandPalette } from "./command-palette";
import { NavLinks } from "./nav-links";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";
import { BreadcrumbProvider, HeaderBreadcrumb } from "./breadcrumb";

const SIDEBAR_COLLAPSED_KEY = "gps.sidebarCollapsed";
const SIDEBAR_WIDTH_EXPANDED = 256;
const SIDEBAR_WIDTH_COLLAPSED = 68;

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="GPS Center หน้าแรก"
      className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <LogoMark />
      {!collapsed && (
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-bold text-white">GPS Center</span>
          <span className="text-xs text-sidebar-foreground/70">
            Config &amp; Firmware
          </span>
        </span>
      )}
    </Link>
  );
}

/**
 * โครง layout หลักของทุกหน้าที่ต้อง login (ทุกหน้ายกเว้น /login) — sidebar
 * คงที่บนจอ desktop (md ขึ้นไป) ยุบเป็นไอคอนได้ (จำค่าไว้ในเครื่อง), เปิดผ่าน
 * Sheet บนจอเล็ก
 *
 * แถบบน: ซ้าย = breadcrumb (แสดงเมื่อลึกกว่าหน้าหลัก — ชื่อหน้าหลักอยู่ที่
 * หัวหน้าอันเดียว ไม่ซ้ำกัน) + ปุ่มค้นหา/Command Palette (Ctrl/Cmd+K),
 * ขวา = สถานะ Server กลาง, สลับธีม, กระดิ่งแจ้งเตือน, เมนูผู้ใช้
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // อ่านค่าที่จำไว้หลัง mount (กัน hydration mismatch) — storage ใช้ไม่ได้ก็ข้าม
  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
      }
    } catch {}
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <BreadcrumbProvider>
      <div className="flex min-h-screen">
        <motion.aside
          initial={false}
          animate={{
            width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
          }}
          transition={spring}
          className="sticky top-0 z-(--z-sidebar) hidden h-screen shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
        >
          <div
            className={cn(
              "flex h-16 shrink-0 items-center border-b border-sidebar-border",
              collapsed ? "justify-center" : "px-5",
            )}
          >
            <Brand collapsed={collapsed} />
          </div>
          <div className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
            <NavLinks collapsed={collapsed} scope="desktop" />
          </div>
          <div className="shrink-0 border-t border-sidebar-border p-3">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "ขยายเมนู" : "ยุบเมนู"}
              className={cn(
                "flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm text-sidebar-foreground/70 outline-none transition-colors duration-(--duration-fast) hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                collapsed && "justify-center px-0",
              )}
            >
              {collapsed ? (
                <PanelLeftOpenIcon className="size-4" />
              ) : (
                <>
                  <PanelLeftCloseIcon className="size-4" />
                  ยุบเมนู
                </>
              )}
            </button>
          </div>
        </motion.aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-(--z-sticky) flex h-16 items-center border-b bg-card px-4 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="เปิดเมนู"
              >
                <Menu />
              </Button>
              <HeaderBreadcrumb />
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="ค้นหาและสั่งงาน"
                className="flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-surface-sunken px-3 text-sm text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring sm:w-72"
              >
                <SearchIcon className="size-4 shrink-0" />
                <span className="hidden min-w-0 flex-1 truncate text-left sm:block">
                  ค้นหาหน้า อุปกรณ์ หรือคำสั่ง
                </span>
                <kbd className="font-instrument ml-auto hidden rounded border bg-card px-1.5 py-0.5 text-[11px] sm:block">
                  Ctrl K
                </kbd>
              </button>
              <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
                <CentralConnection />
                <ThemeToggle />
                <NotificationBell />
                <UserMenu />
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {/* เพดานความกว้างเนื้อหา (ไม่ใช่แค่หน้าฟอร์ม) — เดิม flex-1 ยืดเต็ม
             * พื้นที่ที่เหลือจาก sidebar เสมอไม่มีเพดาน จอกว้างมาก (เช่น 1920px+)
             * เนื้อหาเลยยืดจนดูไม่ได้ตั้งใจออกแบบมา โดยเฉพาะหน้าฟอร์มสั้นๆ ที่
             * ลอยอยู่กลางพื้นที่ว่างมหาศาล — จำกัดไว้ที่ 1400px แล้วจัดกึ่งกลาง
             * แทน (เทียบกับ pattern ทั่วไปของเว็บแอป เช่น Stripe/Linear/GitHub) */}
            <div className="mx-auto max-w-[1400px]">{children}</div>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetHeader className="border-b border-sidebar-border px-5 py-4">
              <SheetTitle className="sr-only">เมนูหลัก</SheetTitle>
              <Brand />
            </SheetHeader>
            <div className="overflow-y-auto px-3 py-4">
              <NavLinks
                scope="mobile"
                onNavigate={() => setMobileNavOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </BreadcrumbProvider>
  );
}
