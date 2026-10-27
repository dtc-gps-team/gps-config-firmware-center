import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { DashboardSummary } from "./dashboard-summary";

type Q<T> = { data: T | null; isLoading: boolean; error: string | null };
const q = <T,>(data: T | null, over: Partial<Q<T>> = {}): Q<T> => ({
  data,
  isLoading: false,
  error: null,
  ...over,
});

const state = vi.hoisted(() => ({
  devices: {} as Q<unknown>,
  configs: {} as Q<unknown>,
  campaigns: {} as Q<unknown>,
  paused: {} as Q<unknown>,
  allRollouts: {} as Q<unknown>,
  incidents: {} as Q<unknown>,
  central: {} as Q<unknown>,
  // ค่าเริ่มต้นเป็น role ที่มีสิทธิ์ `campaign:Read` อยู่แล้ว (Operation) —
  // เทส role ที่ไม่มีสิทธิ์ (รีวิว #373) ตั้งเองในกลุ่มทดสอบของตัวเอง
  role: "Operation" as string | null,
}));

vi.mock("@/hooks/use-devices", () => ({ useDevices: () => state.devices }));
vi.mock("@/hooks/use-configs", () => ({ useConfigs: () => state.configs }));
vi.mock("@/hooks/use-campaigns", () => ({
  useCampaigns: () => state.campaigns,
}));
vi.mock("@/hooks/use-paused-campaign-rollouts", () => ({
  usePausedCampaignRollouts: () => state.paused,
}));
vi.mock("@/hooks/use-all-campaign-rollouts", () => ({
  useAllCampaignRollouts: () => state.allRollouts,
}));
vi.mock("@/hooks/use-incidents", () => ({
  useIncidents: () => state.incidents,
}));
vi.mock("@/hooks/use-central-devices", () => ({
  useCentralDevices: () => state.central,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { role: state.role } }),
}));

const device = (deviceId: string, deviceModel = "ESP32-DEVKIT-V1") => ({
  deviceId,
  deviceModel,
});

const central = (
  deviceId: string,
  online: boolean,
  desired: number | null,
  reported: number | null,
) => ({
  deviceId,
  online,
  desiredConfigVersion: desired,
  reportedConfigVersion: reported,
});

function card(label: string): HTMLElement {
  return screen.getByText(label).closest("a, [data-slot='card']") as HTMLElement;
}

describe("DashboardSummary: ทุกตัวเลขมาจากข้อมูลจริง", () => {
  beforeEach(() => {
    state.role = "Operation";
    state.devices = q([device("BOX-1"), device("BOX-2"), device("BOX-3")]);
    state.configs = q([{ status: "testing" }, { status: "approved" }]);
    state.campaigns = q([{ id: "c1" }]);
    state.paused = q([{ id: "r1" }]);
    state.allRollouts = q([
      { status: "completed", successCount: 5, failureCount: 1 },
      { status: "pending_approval", successCount: 0, failureCount: 0 },
    ]);
    state.incidents = q([
      { status: "open" },
      { status: "investigating" },
      { status: "resolved" },
    ]);
    state.central = q({
      mode: "real",
      reachable: true,
      error: null,
      fetchedAt: "",
      devices: [
        central("BOX-1", true, 9, 9),
        central("BOX-2", false, 9, 8),
      ],
    });
  });

  it("ไม่มีป้าย 'ตัวอย่าง' และไม่มีตัวเลขตายตัวเดิม (142, 128, Reboot Loop ฯลฯ)", () => {
    render(<DashboardSummary />);

    expect(screen.queryByText("ตัวอย่าง")).not.toBeInTheDocument();
    expect(screen.queryByText("Reboot Loop")).not.toBeInTheDocument();
    expect(screen.queryByText("Firmware Suspended")).not.toBeInTheDocument();
    expect(screen.queryByText("142")).not.toBeInTheDocument();
    expect(screen.queryByText("128")).not.toBeInTheDocument();
  });

  it("การ์ดเลขเดี่ยวคำนวณจากข้อมูลจริง", () => {
    render(<DashboardSummary />);

    expect(within(card("Incident ที่ยังต้องตาม")).getByText("2")).toBeInTheDocument();
    expect(within(card("Rollout หยุดชั่วคราว (Auto Pause)")).getByText("1")).toBeInTheDocument();
    // BOX-2 ออฟไลน์ที่เดียว (BOX-3 ไม่อยู่ใน Server กลาง จึงไม่ทราบ ไม่นับเป็นออฟไลน์)
    expect(within(card("อุปกรณ์ออฟไลน์")).getByText("1")).toBeInTheDocument();
    // BOX-2 กล่องรายงาน v8 แต่เป้าหมาย v9
    expect(within(card("Config ไม่ตรงกับที่ตั้งไว้")).getByText("1")).toBeInTheDocument();
    expect(within(card("อุปกรณ์ทั้งหมด")).getByText("3")).toBeInTheDocument();
  });

  it("กราฟการเชื่อมต่อแยกออนไลน์ ออฟไลน์ และไม่ทราบ", () => {
    render(<DashboardSummary />);

    const chart = screen.getByText("การเชื่อมต่อ (Online / Offline)").closest("[data-slot='card']") as HTMLElement;
    expect(within(chart).getByText("ออนไลน์").nextSibling?.textContent).toBe("1");
    expect(within(chart).getByText("ออฟไลน์").nextSibling?.textContent).toBe("1");
    expect(within(chart).getByText("ไม่ทราบ").nextSibling?.textContent).toBe("1");
  });

  it("กราฟผลการ Deploy รวมเฉพาะ Rollout ที่ปล่อยแล้ว", () => {
    render(<DashboardSummary />);

    const chart = screen.getByText("ผลการ Deploy").closest("[data-slot='card']") as HTMLElement;
    expect(within(chart).getByText("สำเร็จ").nextSibling?.textContent).toBe("5");
    expect(within(chart).getByText("ล้มเหลว").nextSibling?.textContent).toBe("1");
  });

  it("ยังไม่มีการ Deploy เลย: บอกตรงๆ ไม่วาดแท่งเปล่า", () => {
    state.allRollouts = q([]);
    render(<DashboardSummary />);

    expect(screen.getByText("ยังไม่มีการ Deploy")).toBeInTheDocument();
  });

  it("Server กลางติดต่อไม่ได้: การ์ดที่พึ่ง Server กลางบอกว่าไม่ทราบ ไม่แสดงเลข 0 ที่ดูเหมือนปกติ", () => {
    state.central = q({
      mode: "real",
      reachable: false,
      error: "x",
      fetchedAt: "",
      devices: [],
    });
    render(<DashboardSummary />);

    expect(within(card("อุปกรณ์ออฟไลน์")).getByText("ไม่ทราบ")).toBeInTheDocument();
    expect(within(card("Config ไม่ตรงกับที่ตั้งไว้")).getByText("ไม่ทราบ")).toBeInTheDocument();
    expect(
      screen.getByText(/ติดต่อ Server กลางไม่ได้ตอนนี้ จึงยังไม่ทราบสถานะการเชื่อมต่อ/),
    ).toBeInTheDocument();
    // การ์ดอื่นไม่กระทบ
    expect(within(card("Incident ที่ยังต้องตาม")).getByText("2")).toBeInTheDocument();
  });

  it("Server กลางอยู่ในโหมด mock: กราฟการเชื่อมต่อมีป้ายข้อมูลตัวอย่าง (ซื่อตรงว่าเป็นข้อมูลตัวอย่าง)", () => {
    state.central = q({
      mode: "mock",
      reachable: true,
      error: null,
      fetchedAt: "",
      devices: [central("BOX-1", true, null, null)],
    });
    render(<DashboardSummary />);

    expect(screen.getByText("ข้อมูลตัวอย่าง")).toBeInTheDocument();
  });

  // รีวิว #373 (B) บน PR #362/#373: FirmwareEngineer/QAEngineer ไม่มีสิทธิ์
  // `campaign:Read` (ดู backend/prisma/seed.ts) — การ์ดที่พึ่งข้อมูล Campaign
  // ควรหายไปเงียบๆ ไม่ใช่โชว์ error 403
  describe("role ที่ไม่มีสิทธิ์ campaign:Read", () => {
    it.each(["FirmwareEngineer", "QAEngineer"])(
      "%s ไม่เห็นการ์ดที่พึ่งข้อมูล Campaign เลย",
      (role) => {
        state.role = role;
        render(<DashboardSummary />);

        expect(
          screen.queryByText("Rollout หยุดชั่วคราว (Auto Pause)"),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("กลุ่มอุปกรณ์ทั้งหมด")).not.toBeInTheDocument();
        expect(screen.queryByText("ผลการ Deploy")).not.toBeInTheDocument();
        // การ์ดอื่นที่ไม่พึ่ง Campaign ต้องยังอยู่ตามปกติ
        expect(
          within(card("Incident ที่ยังต้องตาม")).getByText("2"),
        ).toBeInTheDocument();
      },
    );

    it("role ที่มีสิทธิ์ (เช่น ST) ยังเห็นการ์ด Campaign ตามปกติ", () => {
      state.role = "ST";
      render(<DashboardSummary />);

      expect(
        screen.getByText("Rollout หยุดชั่วคราว (Auto Pause)"),
      ).toBeInTheDocument();
      expect(screen.getByText("กลุ่มอุปกรณ์ทั้งหมด")).toBeInTheDocument();
      expect(screen.getByText("ผลการ Deploy")).toBeInTheDocument();
    });
  });
});
