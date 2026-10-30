import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationBell } from "./notification-bell";
import type { AppNotification } from "@/lib/notification-api";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const state = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("@/components/notifications/notifications-provider", () => ({
  useNotifications: () => state.value,
}));

function n(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    userId: "u1",
    type: "config_override_approved",
    payload: { deviceId: "DEV-1" },
    read: false,
    sentAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function setState(partial: Record<string, unknown>) {
  state.value = {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    error: null,
    panelOpen: true,
    setPanelOpen: vi.fn(),
    markRead: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn(),
    ...partial,
  };
}

describe("NotificationBell", () => {
  beforeEach(() => {
    router.push.mockReset();
    setState({});
  });

  it("ไม่มีที่ยังไม่อ่าน: ไม่มีเลขบนกระดิ่ง และ aria-label ธรรมดา", () => {
    setState({ panelOpen: false });

    render(<NotificationBell />);

    expect(screen.getByRole("button", { name: "แจ้งเตือน" })).toBeInTheDocument();
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
  });

  it("มีที่ยังไม่อ่าน: aria-label บอกจำนวน และเกิน 9 แสดง 9+", () => {
    setState({ panelOpen: false, unreadCount: 12 });

    render(<NotificationBell />);

    expect(
      screen.getByRole("button", { name: "แจ้งเตือน ยังไม่อ่าน 12 รายการ" }),
    ).toBeInTheDocument();
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("แผงว่าง: แสดง 'ยังไม่มีแจ้งเตือน'", () => {
    render(<NotificationBell />);

    expect(screen.getByText("ยังไม่มีแจ้งเตือน")).toBeInTheDocument();
  });

  it("แสดงสูงสุด 20 รายการ แม้ backend คืนมากกว่า", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      n(`n${i}`, { payload: { deviceId: `DEV-${i}` } }),
    );
    setState({ notifications: many, unreadCount: 25 });

    render(<NotificationBell />);

    expect(screen.getAllByRole("listitem")).toHaveLength(20);
  });

  it("ชนิดด่วนมีป้ายข้อความ 'ด่วน' ชนิดอื่นไม่มี", () => {
    setState({
      notifications: [
        n("a", {
          type: "incident_report_pending",
          payload: { incidentId: "inc-1" },
        }),
        n("b"),
      ],
      unreadCount: 2,
    });

    render(<NotificationBell />);

    expect(screen.getAllByText("ด่วน")).toHaveLength(1);
  });

  it("กดรายการที่มีปลายทาง: ทำเป็นอ่านแล้ว ปิดแผง และไปหน้านั้น", async () => {
    const markRead = vi.fn().mockResolvedValue(undefined);
    const setPanelOpen = vi.fn();
    setState({
      notifications: [
        n("a", {
          type: "incident_report_pending",
          payload: { incidentId: "inc-1", deviceId: "DEV-9" },
        }),
      ],
      unreadCount: 1,
      markRead,
      setPanelOpen,
    });
    const user = userEvent.setup();

    render(<NotificationBell />);
    await user.click(
      screen.getByRole("button", { name: /มีรายงานปัญหาหน้างานรอตัดสินใจ/ }),
    );

    expect(markRead).toHaveBeenCalledWith("a");
    expect(setPanelOpen).toHaveBeenCalledWith(false);
    expect(router.push).toHaveBeenCalledWith("/incidents/inc-1");
  });

  it("กดรายการที่ไม่มีปลายทาง: แค่ทำเป็นอ่านแล้ว ไม่เปลี่ยนหน้า", async () => {
    const markRead = vi.fn().mockResolvedValue(undefined);
    setState({
      notifications: [
        n("t", { type: "task_assigned", payload: { title: "ติดตั้งกล่อง" } }),
      ],
      unreadCount: 1,
      markRead,
    });
    const user = userEvent.setup();

    render(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: /มอบหมายงานใหม่/ }));

    expect(markRead).toHaveBeenCalledWith("t");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("โหลดไม่สำเร็จ: แสดงข้อความและปุ่มลองใหม่ที่เรียก refetch", async () => {
    const refetch = vi.fn();
    setState({ error: "โหลดแจ้งเตือนไม่สำเร็จ", refetch });
    const user = userEvent.setup();

    render(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));

    expect(screen.getByText("โหลดแจ้งเตือนไม่สำเร็จ")).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
