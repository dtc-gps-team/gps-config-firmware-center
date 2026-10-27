import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceHistorySheet } from "./device-history-sheet";
import type { DeviceHistoryItem } from "@/lib/device-history-api";

// Operation เห็นทุก pill (task + override ทั้งสองชนิด) — ใช้เป็นค่าเริ่มต้นให้
// เทสต์เดิมที่ไม่ได้ตั้งใจทดสอบเรื่องสิทธิ์ยังเห็นปุ่มครบ 6 ปุ่มเหมือนก่อนแก้
const auth = vi.hoisted(() => ({ role: "Operation" as string | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: auth.role } }),
}));

const loadMore = vi.fn();
const { useDeviceHistory } = vi.hoisted(() => ({ useDeviceHistory: vi.fn() }));
const hookState = vi.hoisted(() => ({
  value: {} as {
    summary: unknown;
    items: unknown[];
    nextCursor: string | null;
    isLoading: boolean;
    isLoadingMore: boolean;
    error: string | null;
    loadMore: () => void;
  },
}));
vi.mock("@/hooks/use-device-history", () => ({
  useDeviceHistory: (...args: unknown[]) => useDeviceHistory(...args),
}));
vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({ resolveName: (id: string) => `ชื่อของ ${id}` }),
}));

function setHook(partial: Partial<typeof hookState.value>) {
  hookState.value = {
    summary: null,
    items: [],
    nextCursor: null,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    loadMore,
    ...partial,
  };
  useDeviceHistory.mockReturnValue(hookState.value);
}

function rolloutItem(
  overrides: Partial<DeviceHistoryItem> = {},
): DeviceHistoryItem {
  return {
    id: "rollout:t-1",
    type: "rollout",
    occurredAt: "2026-01-02T00:00:00Z",
    status: "success",
    title: "กลุ่มรถบรรทุก",
    detail: null,
    actorId: "u-1",
    payloadType: "Config",
    isRollback: false,
    severity: null,
    config: { id: "cfg-1", name: "GT06N มาตรฐาน", versionNumber: 3 },
    firmware: null,
    decision: null,
    refs: {
      campaignId: "camp-1",
      rolloutId: "roll-1",
      taskId: null,
      incidentId: null,
      overrideId: null,
    },
    ...overrides,
  };
}

/** เปิด Sheet ก่อนเช็คเนื้อหา — timeline mount แบบ lazy ตอนเปิดเท่านั้น
 * (กันตารางที่มีหลายเครื่องยิงคำขอประวัติทุกแถวตั้งแต่โหลดหน้า) */
async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "ดูประวัติ" }));
}

/**
 * รีวิวพี่เลี้ยง 19 ต.ค. 2569 + ฟีดแบ็ก 25 ต.ค.: อยากรู้ว่าเครื่องนี้เคยทำอะไร
 * มาบ้าง เลือกดูได้ทีละเครื่อง — ใช้ปุ่มเปิด Sheet แทนการ์ดฝังถาวร (เดิมทำให้
 * หน้า Device Detail เลื่อนยาวเกินไป) ใช้ได้ทั้งหน้า Device Detail และตาราง
 * สมาชิก Campaign
 */
describe("DeviceHistorySheet", () => {
  beforeEach(() => {
    useDeviceHistory.mockReset();
    setHook({});
    loadMore.mockReset();
    auth.role = "Operation";
  });

  it("ยังไม่กดดูประวัติ: ไม่โหลดอะไร มีแค่ปุ่ม", () => {
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    expect(screen.getByRole("button", { name: "ดูประวัติ" })).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีประวัติของเครื่องนี้")).not.toBeInTheDocument();
  });

  it("กดดูประวัติ กำลังโหลดครั้งแรก: แสดงโครงรอ ไม่แสดงรายการ", async () => {
    setHook({ isLoading: true });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);

    expect(screen.getByLabelText("กำลังโหลดประวัติ")).toBeInTheDocument();
  });

  it("ไม่มีประวัติเลย: บอกว่ายังไม่มี ไม่พังหรือโชว์ error", async () => {
    setHook({ items: [] });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);

    expect(
      screen.getByText("ยังไม่มีประวัติของเครื่องนี้"),
    ).toBeInTheDocument();
  });

  it("แสดงสรุป Config/Firmware ที่ใช้อยู่ตอนนี้", async () => {
    setHook({
      summary: {
        currentConfig: { id: "cfg-1", name: "GT06N มาตรฐาน" },
        currentFirmware: { id: "fw-1", version: "1.2.0" },
      },
      items: [rolloutItem()],
    });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);

    expect(screen.getByText(/ใช้อยู่: GT06N มาตรฐาน/)).toBeInTheDocument();
    expect(screen.getByText(/Firmware: v1\.2\.0/)).toBeInTheDocument();
  });

  it("รายการ rollout: แสดงชื่อแคมเปญ, Config, สถานะ, ผู้ทำรายการ และลิงก์ไปหน้า Rollout", async () => {
    setHook({ items: [rolloutItem()] });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);

    expect(screen.getByText("กลุ่มรถบรรทุก")).toBeInTheDocument();
    expect(screen.getByText(/GT06N มาตรฐาน/)).toBeInTheDocument();
    expect(screen.getByText("สำเร็จ")).toBeInTheDocument();
    expect(screen.getByText("ชื่อของ u-1")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/campaigns/camp-1/rollouts/roll-1",
    );
  });

  it("ชนิดรายการที่ไม่รู้จัก (backend เพิ่มชนิดใหม่ในอนาคต) — แสดง fallback ไม่พัง", async () => {
    setHook({
      items: [
        rolloutItem({
          id: "unknown:1",
          type: "device-check-in",
          title: "เช็คอินใหม่",
          config: null,
          refs: {
            campaignId: null,
            rolloutId: null,
            taskId: null,
            incidentId: null,
            overrideId: null,
          },
        }),
      ],
    });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);

    expect(screen.getByText("เช็คอินใหม่")).toBeInTheDocument();
    expect(screen.getByText("device-check-in")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("มี nextCursor -> แสดงปุ่มโหลดเพิ่ม กดแล้วเรียก loadMore", async () => {
    setHook({ items: [rolloutItem()], nextCursor: "cursor-1" });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);
    await user.click(screen.getByRole("button", { name: "โหลดเพิ่ม" }));

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("ไม่มี nextCursor -> ไม่แสดงปุ่มโหลดเพิ่ม", async () => {
    setHook({ items: [rolloutItem()], nextCursor: null });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);

    expect(
      screen.queryByRole("button", { name: "โหลดเพิ่ม" }),
    ).not.toBeInTheDocument();
  });

  it("incident: แสดงความรุนแรงและลิงก์ไปหน้า Incident", async () => {
    setHook({
      items: [
        rolloutItem({
          id: "incident:1",
          type: "incident",
          title: "Config ไม่สำเร็จ",
          severity: "high",
          config: null,
          refs: {
            campaignId: null,
            rolloutId: null,
            taskId: null,
            incidentId: "inc-1",
            overrideId: null,
          },
        }),
      ],
    });
    const user = userEvent.setup();
    render(<DeviceHistorySheet deviceId="DEV-0001" />);

    await openSheet(user);

    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/incidents/inc-1");
  });

  describe("กรองประเภท", () => {
    it("ค่าเริ่มต้นเลือกทุกประเภท — เรียก useDeviceHistory ด้วย types: undefined (ไม่กรอง)", async () => {
      setHook({ items: [rolloutItem()] });
      const user = userEvent.setup();
      render(<DeviceHistorySheet deviceId="DEV-0001" />);

      await openSheet(user);

      expect(useDeviceHistory).toHaveBeenLastCalledWith("DEV-0001", undefined);
    });

    it("กดปิดประเภทหนึ่ง -> เรียกใหม่ด้วย types ที่เหลือ (ไม่รวมประเภทที่ปิด)", async () => {
      setHook({ items: [rolloutItem()] });
      const user = userEvent.setup();
      render(<DeviceHistorySheet deviceId="DEV-0001" />);

      await openSheet(user);
      await user.click(screen.getByRole("button", { name: "Incident" }));

      const lastCall = useDeviceHistory.mock.calls.at(-1) as [
        string,
        string[] | undefined,
      ];
      expect(lastCall[0]).toBe("DEV-0001");
      expect(lastCall[1]).not.toContain("incident");
      expect(lastCall[1]).toContain("rollout");
    });

    it("ไม่มีรายการในประเภทที่เลือก -> บอกว่าไม่มีประวัติในประเภทที่เลือก (ไม่ใช่ข้อความกลาง)", async () => {
      // mock ตอบ items: [] ไว้ล่วงหน้า (จำลองผลที่ backend ตอบกลับหลังกรอง) —
      // ต้อง set ก่อนคลิก เพราะ re-render ที่คลิกทำให้เกิดขึ้นจะอ่าน mock
      // return value ตอนนั้นเลย เปลี่ยน mock ทีหลังไม่ทำให้ re-render เอง
      setHook({ items: [] });
      const user = userEvent.setup();
      render(<DeviceHistorySheet deviceId="DEV-0001" />);

      await openSheet(user);
      await user.click(screen.getByRole("button", { name: "Incident" }));

      expect(
        await screen.findByText("ไม่มีประวัติในประเภทที่เลือก"),
      ).toBeInTheDocument();
    });

    it("ปิดจนเหลือประเภทเดียว กดปิดอีกครั้ง -> ไม่มีผล (ต้องเหลืออย่างน้อย 1 ประเภทเสมอ)", async () => {
      setHook({ items: [rolloutItem()] });
      const user = userEvent.setup();
      render(<DeviceHistorySheet deviceId="DEV-0001" />);

      await openSheet(user);
      for (const label of [
        "Rollout",
        "Config เฉพาะเครื่อง",
        "Firmware เฉพาะเครื่อง",
        "งาน",
        "ลงทะเบียน/ติดตั้ง",
      ]) {
        await user.click(screen.getByRole("button", { name: label }));
      }

      // เหลือ "Incident" ตัวเดียว กดปิดตัวนี้ไม่มีผล — ปุ่มยังต้องค้างสถานะ
      // "เลือกอยู่" (ไม่ใช่เช็คจำนวนครั้งที่เรียก useDeviceHistory เพราะ mock
      // ถูกเรียกซ้ำได้จาก re-render อื่นที่ไม่เกี่ยวกับ state นี้)
      const incidentButton = screen.getByRole("button", { name: "Incident" });
      expect(incidentButton).toHaveAttribute("aria-pressed", "true");
      await user.click(incidentButton);

      expect(incidentButton).toHaveAttribute("aria-pressed", "true");
      expect(
        useDeviceHistory.mock.calls.at(-1)?.[1],
      ).toContain("incident");
    });
  });

  // รีวิว B บน #371: ซ่อน pill ของชนิดที่ role นั้นไม่มีสิทธิ์เห็นเลย กัน
  // "กดปุ่มแล้วไม่มีผล" (backend เงียบๆ ไม่คืนรายการชนิดนั้นมา)
  describe("ซ่อนปุ่มกรองตามสิทธิ์ของ role", () => {
    it("QAEngineer ไม่มี tasks:Read และไม่มี override:Read/Create เลย -> ไม่เห็นปุ่มงาน/Config เฉพาะเครื่อง/Firmware เฉพาะเครื่อง", async () => {
      auth.role = "QAEngineer";
      const user = userEvent.setup();
      render(<DeviceHistorySheet deviceId="DEV-0001" />);
      await openSheet(user);

      expect(
        screen.queryByRole("button", { name: "งาน" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Config เฉพาะเครื่อง" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Firmware เฉพาะเครื่อง" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Rollout" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Incident" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "ลงทะเบียน/ติดตั้ง" }),
      ).toBeInTheDocument();
    });

    it("ST เห็นปุ่มงานและ override ได้ (เห็นแค่ของตัวเอง ฝั่ง backend กรองให้)", async () => {
      auth.role = "ST";
      const user = userEvent.setup();
      render(<DeviceHistorySheet deviceId="DEV-0001" />);
      await openSheet(user);

      expect(screen.getByRole("button", { name: "งาน" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Config เฉพาะเครื่อง" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Firmware เฉพาะเครื่อง" }),
      ).toBeInTheDocument();
    });

    it("OT เห็นปุ่มงานได้ แต่ไม่เห็นปุ่ม override (seed.ts ให้ ST เท่านั้น)", async () => {
      auth.role = "OT";
      const user = userEvent.setup();
      render(<DeviceHistorySheet deviceId="DEV-0001" />);
      await openSheet(user);

      expect(screen.getByRole("button", { name: "งาน" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Config เฉพาะเครื่อง" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Firmware เฉพาะเครื่อง" }),
      ).not.toBeInTheDocument();
    });
  });
});
