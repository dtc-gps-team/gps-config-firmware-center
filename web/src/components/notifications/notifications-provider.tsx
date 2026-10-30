"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  listNotifications,
  markNotificationRead,
  type AppNotification,
} from "@/lib/notification-api";
import { describeNotification } from "@/lib/notification-display";
import { useRefetchOnFocus } from "@/hooks/use-refetch-on-focus";
import {
  PENDING_QUEUE_POLL_INTERVAL_MS,
  usePollInterval,
} from "@/hooks/use-poll-interval";

type NotificationsContextValue = {
  /** ใหม่สุดก่อน ทุกรายการที่ backend คืน (UI ตัดแสดงเอง) */
  notifications: AppNotification[];
  /** นับจากทุกรายการที่ยังไม่อ่าน ไม่ใช่แค่ที่แสดงในแผง */
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  markRead: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
);

/**
 * ศูนย์แจ้งเตือนของเว็บ — **ผู้ถือข้อมูลจุดเดียว** (อยู่ใน AppShell) ให้เลขบน
 * กระดิ่ง รายการในแผง และ toast ใช้ข้อมูลชุดเดียวกัน ไม่ยิง request ซ้ำ
 *
 * ตอนนี้ได้ข้อมูลด้วย polling ทุก 20 วินาที (+ ตอนกลับมาโฟกัสแท็บ) — วิธีได้
 * ข้อมูลซ่อนอยู่ในนี้ทั้งหมด ภายหลังเปลี่ยนเป็น WebSocket ที่ไฟล์นี้ที่เดียว
 * ผู้ใช้ context (`useNotifications`) ไม่ต้องแก้
 *
 * ตาราง `Notification` ใน DB เป็นแหล่งความจริงเสมอ — ช่องทางส่งแค่บอกว่า
 * "มีของใหม่" จึงไม่มีแจ้งเตือนหายแม้การเชื่อมต่อหลุด
 */
export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const role = session?.role ?? null;

  const [items, setItems] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // id ที่เคยเห็นแล้ว — ใช้ตรวจ "รายการที่เพิ่งโผล่" (null = ยังไม่โหลดสำเร็จ
  // ครั้งแรก จึงไม่ toast ตอนเปิดหน้า)
  const seenIdsRef = useRef<Set<string> | null>(null);
  // id ที่ผู้ใช้กดอ่านแล้วแต่ server ยังอาจตอบค่าเก่ากลับมา (request ที่ออกไป
  // ก่อนหน้า) — overlay กันตัวเลขเด้งกลับ
  const readOverlayRef = useRef<Set<string>>(new Set());
  const panelOpenRef = useRef(false);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  const refetch = useCallback(async () => {
    if (!token) return;
    try {
      const fetched = await listNotifications(token);
      const merged = fetched.map((n) =>
        readOverlayRef.current.has(n.id) ? { ...n, read: true } : n,
      );
      // server ยืนยันว่าอ่านแล้ว ไม่ต้องใช้ overlay อีก
      for (const n of fetched) {
        if (n.read) readOverlayRef.current.delete(n.id);
      }

      const seen = seenIdsRef.current;
      if (seen !== null) {
        const fresh = merged.filter((n) => !n.read && !seen.has(n.id));
        if (fresh.length > 0 && !panelOpenRef.current) {
          const message =
            fresh.length === 1
              ? `มีแจ้งเตือนใหม่: ${describeNotification(fresh[0], role).title}`
              : `มีแจ้งเตือนใหม่ ${fresh.length} รายการ`;
          toast.info(message, {
            action: { label: "ดู", onClick: () => setPanelOpen(true) },
          });
        }
      }
      seenIdsRef.current = new Set(merged.map((n) => n.id));

      setItems(merged);
      setError(null);
    } catch (err) {
      // พังไม่ block หน้า — คงรายการล่าสุดไว้ แค่เก็บข้อความให้แผงแสดง
      setError(
        err instanceof ApiError ? err.message : "โหลดแจ้งเตือนไม่สำเร็จ",
      );
    } finally {
      setIsLoading(false);
    }
  }, [token, role]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRefetchOnFocus(refetch);
  usePollInterval(() => void refetch(), PENDING_QUEUE_POLL_INTERVAL_MS);

  const markRead = useCallback(
    async (id: string) => {
      if (!token) return;
      const target = items.find((n) => n.id === id);
      if (!target || target.read) return;

      // optimistic: ตัวเลขลดทันที ถ้าบันทึกไม่สำเร็จค่อยย้อนกลับ
      readOverlayRef.current.add(id);
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      try {
        await markNotificationRead(token, id);
      } catch (err) {
        readOverlayRef.current.delete(id);
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: false } : n)),
        );
        toast.error(
          err instanceof ApiError
            ? err.message
            : "ทำเครื่องหมายอ่านแล้วไม่สำเร็จ",
        );
      }
    },
    [token, items],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications: items,
      unreadCount: items.filter((n) => !n.read).length,
      isLoading,
      error,
      panelOpen,
      setPanelOpen,
      markRead,
      refetch,
    }),
    [items, isLoading, error, panelOpen, markRead, refetch],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      "useNotifications ต้องอยู่ภายใต้ NotificationsProvider (ดู AppShell)",
    );
  }
  return ctx;
}
