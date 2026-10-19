"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, LogOutIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/components/auth/auth-provider";
import { useUserNames } from "@/hooks/use-user-names";
import { getTokenSubject } from "@/lib/jwt";

/** "ConfigEngineer" → "Config Engineer", "QAEngineer" → "QA Engineer" —
 *  role code ยังเป็นค่าเดิมทุกที่ เปลี่ยนแค่ตอนแสดงให้คนอ่าน */
export function formatRoleLabel(role: string): string {
  return role
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
}

/** ตัวย่อใน avatar — ชื่อไทยสองคำได้พยัญชนะต้นของแต่ละคำ ("ณัฐพล ศรีสุข" →
 *  "ณศ") ไม่มีชื่อใช้ตัวแรกของ role */
function initialsOf(name: string | null, role: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts
      .slice(0, 2)
      .map((p) => Array.from(p)[0])
      .join("");
  }
  return Array.from(role)[0] ?? "?";
}

/**
 * ปุ่มผู้ใช้มุมขวาบน (แทนข้อความ role ดิบ + ปุ่ม "ออกจากระบบ" ที่วางโล่งๆ
 * เดิม) — ชื่อดึงจาก `GET /users` ตาม user id ใน token (session เก็บแค่
 * token + role ไม่มีชื่อ) โหลดไม่ได้ก็แสดงแค่ role ไม่บล็อกการใช้งาน
 */
export function UserMenu() {
  const router = useRouter();
  const { session, logout } = useAuth();
  const { resolveName } = useUserNames();
  const [open, setOpen] = useState(false);

  const role = session?.role ?? "";
  const userId = useMemo(
    () => (session ? getTokenSubject(session.accessToken) : null),
    [session],
  );
  // resolveName คืน id เดิมเมื่อหาชื่อไม่เจอ (ยังโหลดไม่เสร็จ/โหลดพัง) —
  // กรณีนั้นถือว่าไม่มีชื่อ แสดงแค่ role แทน id ดิบ
  const resolved = userId ? resolveName(userId) : null;
  const fullName = resolved && resolved !== userId ? resolved : null;
  const roleLabel = formatRoleLabel(role);

  function handleLogout() {
    setOpen(false);
    logout();
    router.replace("/login");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`บัญชีผู้ใช้ ${fullName ?? roleLabel}`}
        className="flex h-11 items-center gap-2.5 rounded-lg px-1.5 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring sm:pr-2.5"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
          {initialsOf(fullName, role)}
        </span>
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-sm font-semibold">
            {fullName ?? roleLabel}
          </span>
          {fullName && (
            <span className="truncate text-xs text-muted-foreground">
              {roleLabel}
            </span>
          )}
        </span>
        <ChevronDownIcon className="hidden size-4 text-muted-foreground sm:block" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-60 p-1.5">
        <div className="border-b px-2.5 pt-1.5 pb-3">
          <p className="truncate text-sm font-semibold">
            {fullName ?? roleLabel}
          </p>
          <span className="mt-2 inline-flex rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            {roleLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-1 flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-destructive outline-none transition-colors hover:bg-secondary focus-visible:bg-secondary"
        >
          <LogOutIcon className="size-4" />
          ออกจากระบบ
        </button>
      </PopoverContent>
    </Popover>
  );
}
