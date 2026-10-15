"use client";

import { BellIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { formatRelativeTime } from "@/lib/format-date";
import { describeNotification } from "@/lib/notification-display";
import type { AppNotification } from "@/lib/notification-api";
import { cn } from "@/lib/utils";

/** จำนวนรายการที่แสดงในแผง — backend ยังไม่แบ่งหน้า คืนทุกแถว จึงตัดฝั่งเว็บ */
export const NOTIFICATION_PANEL_LIMIT = 20;

/**
 * กระดิ่งแจ้งเตือนที่แถบบน + แผงรายการ — ข้อมูลมาจาก `NotificationsProvider`
 * (AppShell) ที่เดียว กดรายการ = ทำเป็นอ่านแล้ว + ไปหน้าที่เกี่ยวข้อง
 * (รายการที่ไม่มีปลายทางที่แน่นอนแค่ทำเป็นอ่านแล้ว)
 */
export function NotificationBell() {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    panelOpen,
    setPanelOpen,
    markRead,
    refetch,
  } = useNotifications();

  const shown = notifications.slice(0, NOTIFICATION_PANEL_LIMIT);
  const badge = unreadCount > 9 ? "9+" : String(unreadCount);
  const label =
    unreadCount > 0
      ? `แจ้งเตือน ยังไม่อ่าน ${unreadCount} รายการ`
      : "แจ้งเตือน";

  function handleSelect(n: AppNotification, href: string | null) {
    void markRead(n.id);
    setPanelOpen(false);
    if (href) router.push(href);
  }

  return (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className="relative"
          />
        }
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white"
          >
            {badge}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22.5rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">แจ้งเตือน</span>
          {unreadCount > 0 && (
            <span className="text-xs text-muted-foreground">
              ยังไม่อ่าน {unreadCount} รายการ
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-destructive">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => void refetch()}>
              ลองใหม่
            </Button>
          </div>
        )}

        {shown.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {isLoading ? "กำลังโหลด…" : "ยังไม่มีแจ้งเตือน"}
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((n) => {
              const view = describeNotification(n);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(n, view.href)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                      !n.read && "bg-muted/30",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.read ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-start gap-1.5">
                        <span
                          className={cn(
                            "text-sm",
                            !n.read && "font-semibold",
                          )}
                        >
                          {view.title}
                        </span>
                        {view.urgent && (
                          <span className="mt-0.5 shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-destructive">
                            ด่วน
                          </span>
                        )}
                      </span>
                      {view.details.map((d) => (
                        <span
                          key={d}
                          className="truncate text-xs text-muted-foreground"
                        >
                          {d}
                        </span>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
