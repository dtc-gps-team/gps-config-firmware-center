"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LogoMark } from "@/components/brand/logo-mark";
import { NavLinks } from "./nav-links";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";
import { BreadcrumbProvider, HeaderBreadcrumb } from "./breadcrumb";

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <LogoMark />
      <span className="flex flex-col leading-tight">
        <span className="text-[15px] font-bold text-white">GPS Center</span>
        <span className="text-xs text-sidebar-foreground/70">
          Config &amp; Firmware
        </span>
      </span>
    </Link>
  );
}

/**
 * โครง layout หลักของทุกหน้าที่ต้อง login (ทุกหน้ายกเว้น /login) — sidebar
 * คงที่บนจอ desktop (md ขึ้นไป), เปิดผ่าน Sheet บนจอเล็ก
 *
 * แถบบน (UI ปรับใหม่ 2026-10): ซ้าย = breadcrumb (บอกว่าอยู่ตรงไหน),
 * ขวา = กระดิ่งแจ้งเตือน + เมนูผู้ใช้ (ชื่อ, role, ออกจากระบบ) แทนข้อความ
 * role ดิบกับปุ่ม "ออกจากระบบ" ที่วางโล่งๆ เดิม
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <BreadcrumbProvider>
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
          <div className="flex h-16 items-center border-b border-sidebar-border px-5">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <NavLinks />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-card px-4 sm:px-6 lg:px-8">
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
              <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
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
              <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </BreadcrumbProvider>
  );
}
