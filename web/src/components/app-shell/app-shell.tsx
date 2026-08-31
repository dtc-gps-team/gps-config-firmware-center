"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";

/**
 * โครง layout หลักของทุกหน้าที่ต้อง login (ทุกหน้ายกเว้น /login) — sidebar
 * คงที่บนจอ desktop (md ขึ้นไป), เปิดผ่าน Sheet บนจอเล็ก
 *
 * ยังไม่มี role-based nav filtering และยังไม่ต่อ user info จริงจาก JWT — รอ
 * Web auth context (backend #23 เสร็จแล้ว แต่ฝั่ง Web ยังไม่ต่อ fetch
 * client/เก็บ token) ซึ่งไม่ใช่ scope ของ #27 (ดู TODO ใน header ด้านล่าง)
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-background md:flex md:flex-col">
        <div className="flex h-14 items-center px-4">
          <span className="text-sm font-semibold">GPS Config Center</span>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="เปิดเมนู"
          >
            <Menu />
          </Button>
          <span className="text-sm font-semibold md:hidden">
            GPS Config Center
          </span>
          <div className="ml-auto text-sm text-muted-foreground">
            {/* TODO: แสดง username/role จริงตอนต่อ Web auth context */}
            ยังไม่ได้ login
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader>
            <SheetTitle>GPS Config Center</SheetTitle>
          </SheetHeader>
          <div className="p-3">
            <NavLinks onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
