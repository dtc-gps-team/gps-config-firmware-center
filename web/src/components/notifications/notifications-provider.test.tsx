import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import {
  NotificationsProvider,
  useNotifications,
} from "./notifications-provider";
import type { AppNotification } from "@/lib/notification-api";

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));
vi.mock("@/lib/notification-api", () => api);

const toastApi = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

function n(id: string, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    userId: "u1",
    type: "incident_report_pending",
    payload: { incidentId: `inc-${id}` },
    read: false,
    sentAt: null,
    createdAt: "2026-10-14T08:00:00Z",
    ...overrides,
  };
}

// เก็บค่าล่าสุดของ context ไว้ให้เทสเรียก markRead/setPanelOpen
const probe: { current: ReturnType<typeof useNotifications> | null } = {
  current: null,
};
function ctx() {
  if (!probe.current) throw new Error("provider ยังไม่ render");
  return probe.current;
}
function Probe() {
  const value = useNotifications();
  useEffect(() => {
    probe.current = value;
  });
  return (
    <div>
      <span data-testid="unread">{value.unreadCount}</span>
      <span data-testid="total">{value.notifications.length}</span>
    </div>
  );
}

async function mount() {
  render(
    <NotificationsProvider>
      <Probe />
    </NotificationsProvider>,
  );
  await act(async () => {});
}

describe("NotificationsProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.listNotifications.mockReset();
    api.markNotificationRead.mockReset();
    toastApi.info.mockReset();
    toastApi.error.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("โหลดครั้งแรก: นับจำนวนที่ยังไม่อ่าน และไม่ toast", async () => {
    api.listNotifications.mockResolvedValue([
      n("a"),
      n("b", { read: true }),
      n("c"),
    ]);

    await mount();

    expect(screen.getByTestId("total")).toHaveTextContent("3");
    expect(screen.getByTestId("unread")).toHaveTextContent("2");
    expect(toastApi.info).not.toHaveBeenCalled();
  });

  it("polling ทุก 20 วินาที: รายการใหม่รายการเดียว toast ชื่อเรื่อง", async () => {
    api.listNotifications.mockResolvedValueOnce([n("a")]);
    await mount();
    api.listNotifications.mockResolvedValue([n("b"), n("a")]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(api.listNotifications).toHaveBeenCalledTimes(2);
    expect(toastApi.info).toHaveBeenCalledTimes(1);
    expect(toastApi.info.mock.calls[0][0]).toContain(
      "มีรายงานปัญหาหน้างานรอตัดสินใจ",
    );
    expect(screen.getByTestId("unread")).toHaveTextContent("2");
  });

  it("หลายรายการใหม่ในรอบเดียว: toast รวมเป็นข้อความเดียว", async () => {
    api.listNotifications.mockResolvedValueOnce([n("a")]);
    await mount();
    api.listNotifications.mockResolvedValue([n("d"), n("c"), n("b"), n("a")]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(toastApi.info).toHaveBeenCalledTimes(1);
    expect(toastApi.info.mock.calls[0][0]).toBe("มีแจ้งเตือนใหม่ 3 รายการ");
  });

  it("แผงเปิดอยู่: ไม่ toast", async () => {
    api.listNotifications.mockResolvedValueOnce([n("a")]);
    await mount();
    act(() => ctx().setPanelOpen(true));
    api.listNotifications.mockResolvedValue([n("b"), n("a")]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(toastApi.info).not.toHaveBeenCalled();
  });

  it("รายการที่อ่านแล้วที่เพิ่งโผล่: ไม่ toast", async () => {
    api.listNotifications.mockResolvedValueOnce([n("a")]);
    await mount();
    api.listNotifications.mockResolvedValue([n("b", { read: true }), n("a")]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(toastApi.info).not.toHaveBeenCalled();
  });

  it("markRead: ตัวเลขลดทันที (optimistic) และเรียก API", async () => {
    api.listNotifications.mockResolvedValue([n("a"), n("b")]);
    api.markNotificationRead.mockResolvedValue(n("a", { read: true }));
    await mount();

    await act(async () => {
      await ctx().markRead("a");
    });

    expect(api.markNotificationRead).toHaveBeenCalledWith("tok", "a");
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
  });

  it("markRead ล้มเหลว: ย้อนกลับตัวเลขและแจ้ง error", async () => {
    api.listNotifications.mockResolvedValue([n("a")]);
    api.markNotificationRead.mockRejectedValue(new Error("network"));
    await mount();

    await act(async () => {
      await ctx().markRead("a");
    });

    expect(screen.getByTestId("unread")).toHaveTextContent("1");
    expect(toastApi.error).toHaveBeenCalledTimes(1);
  });

  it("อ่านแล้วแต่ poll ถัดมายังได้ค่าเก่าจาก server: ตัวเลขไม่เด้งกลับ", async () => {
    api.listNotifications.mockResolvedValue([n("a")]);
    api.markNotificationRead.mockResolvedValue(n("a", { read: true }));
    await mount();
    await act(async () => {
      await ctx().markRead("a");
    });

    // server ยังตอบ read: false (request ที่ออกไปก่อนหน้า)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });

  it("โหลดไม่สำเร็จ: คงรายการเดิมไว้ และเก็บข้อความ error", async () => {
    api.listNotifications.mockResolvedValueOnce([n("a")]);
    await mount();
    api.listNotifications.mockRejectedValue(new Error("down"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByTestId("total")).toHaveTextContent("1");
    expect(ctx().error).toBe("โหลดแจ้งเตือนไม่สำเร็จ");
  });
});
