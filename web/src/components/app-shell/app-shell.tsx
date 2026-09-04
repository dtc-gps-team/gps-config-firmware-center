"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/components/auth/auth-provider";
import { NavLinks } from "./nav-links";

/**
 * โครง layout หลักของทุกหน้าที่ต้อง login (ทุกหน้ายกเว้น /login) — sidebar
 * คงที่บนจอ desktop (md ขึ้นไป), เปิดผ่าน Sheet บนจอเล็ก
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="flex h-14 items-center px-4">
          <span className="text-sm font-semibold">GPS Config Center</span>
        </div>
        <Separator className="bg-sidebar-border" />
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
          <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            <span>{session?.role ?? "—"}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              ออกจากระบบ
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader>
            <SheetTitle className="text-sidebar-foreground">
              GPS Config Center
            </SheetTitle>
          </SheetHeader>
          <div className="p-3">
            <NavLinks onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
