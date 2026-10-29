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

/** JWT จำลองที่มีแค่ `sub` (getTokenSubject ไม่ verify signature) */
const jwtFor = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

const state = vi.hoisted(() => ({
  devices: {} as Q<unknown>,
  configs: {} as Q<unknown>,
  campaigns: {} as Q<unknown>,
  paused: {} as Q<unknown>,
  allRollouts: {} as Q<unknown>,
  incidents: {} as Q<unknown>,
  central: {} as Q<unknown>,
  firmware: {} as Q<unknown>,
  pendingConfigs: {} as Q<unknown>,
  pendingRollouts: {} as Q<unknown>,
  pendingConfigOverrides: {} as Q<unknown>,
  pendingFirmwareOverrides: {} as Q<unknown>,
  // ค่าเริ่มต้นเป็น role ที่มีสิทธิ์ `campaign:Read` อยู่แล้ว (Operation) —
  // เทส role อื่นตั้งเองในกลุ่มทดสอบของตัวเอง
  role: "Operation" as string | null,
  userId: "me",
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
vi.mock("@/hooks/use-firmware", () => ({
  useFirmwareList: () => ({ ...state.firmware, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-pending-approvals", () => ({
  usePendingApprovals: () => state.pendingConfigs,
}));
vi.mock("@/hooks/use-pending-campaign-rollouts", () => ({
  usePendingCampaignRollouts: () => state.pendingRollouts,
}));
vi.mock("@/hooks/use-pending-device-config-overrides", () => ({
  usePendingDeviceConfigOverrides: () => state.pendingConfigOverrides,
}));
vi.mock("@/hooks/use-pending-device-firmware-overrides", () => ({
  usePendingDeviceFirmwareOverrides: () => state.pendingFirmwareOverrides,
}));
vi.mock("@/hooks/use-audit-logs", () => ({
  useAuditLogs: () => ({ ...q([]), refetch: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { role: state.role, accessToken: jwtFor(state.userId) },
  }),
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
  lastSeenAt: null,
  desiredConfigVersion: desired,
  reportedConfigVersion: reported,
});

const healthCard = () =>
  screen.getByText("สถานะระบบ").closest("[data-slot='card']") as HTMLElement;
const queueCard = () =>
  screen.getByText("งานที่ต้องดำเนินการ").closest("[data-slot='card']") as HTMLElement;
/** แผงตามหัวข้อ (สถานะอุปกรณ์, ผลการ Deploy ฯลฯ) */
const panel = (title: string) =>
  screen.getByText(title).closest("[data-slot='card']") as HTMLElement;
/** แถวในการ์ด "สถานะระบบ" ตามชื่อ */
const health = (label: string) =>
  within(healthCard()).getByText(label).closest("li") as HTMLElement;

describe("DashboardSummary: ทุกตัวเลขมาจากข้อมูลจริง", () => {
  beforeEach(() => {
    state.role = "Operation";
    state.userId = "me";
    state.devices = q([device("BOX-1"), device("BOX-2"), device("BOX-3")]);
    state.configs = q([{ status: "testing", createdBy: "me" }]);
    state.campaigns = q([{ id: "c1", name: "กลุ่มทดสอบ" }]);
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
      devices: [central("BOX-1", true, 9, 9), central("BOX-2", false, 9, 8)],
    });
    state.firmware = q([]);
    state.pendingConfigs = q([]);
    state.pendingRollouts = q([]);
    state.pendingConfigOverrides = q([]);
    state.pendingFirmwareOverrides = q([]);
  });

  it("ไม่มีป้าย 'ตัวอย่าง' และไม่มีตัวเลขตายตัวเดิม (142, 128, Reboot Loop ฯลฯ)", () => {
    render(<DashboardSummary />);

    expect(screen.queryByText("ตัวอย่าง")).not.toBeInTheDocument();
    expect(screen.queryByText("Reboot Loop")).not.toBeInTheDocument();
    expect(screen.queryByText("Firmware Suspended")).not.toBeInTheDocument();
    expect(screen.queryByText("142")).not.toBeInTheDocument();
    expect(screen.queryByText("128")).not.toBeInTheDocument();
  });

  it("สถานะระบบคำนวณจากข้อมูลจริง", () => {
    render(<DashboardSummary />);

    // Incident อยู่ในคิวงานแล้ว ไม่แสดงซ้ำในสถานะระบบ
    expect(within(queueCard()).getByText("Incident ที่ยังเปิดอยู่")).toBeInTheDocument();
    expect(within(healthCard()).queryByText("Incident ที่ยังเปิดอยู่")).not.toBeInTheDocument();
    // BOX-2 ออฟไลน์ที่เดียว (BOX-3 ไม่อยู่ใน Server กลาง จึงไม่ทราบ ไม่นับเป็นออฟไลน์)
    expect(within(health("อุปกรณ์ออฟไลน์")).getByText("1")).toBeInTheDocument();
    // BOX-2 กล่องรายงาน v8 แต่เป้าหมาย v9
    expect(
      within(health("อุปกรณ์ที่ Config ยังไม่อัปเดต")).getByText("1"),
    ).toBeInTheDocument();
  });

  it("Operation: คิว 'งานที่ต้องดำเนินการ' แสดงงานที่ต้องตัดสินใจเรียงตามความเร่งด่วน", () => {
    state.pendingConfigs = q([{ queuedAt: new Date().toISOString() }]);
    state.pendingRollouts = q([{}, {}]);
    render(<DashboardSummary />);

    const queue = within(queueCard());
    const titles = queue
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    // ผิดปกติ (Rollout หยุดเอง, Incident) มาก่อนงานรออนุมัติ
    expect(titles[0]).toContain("Rollout ที่ระบบหยุดเอง");
    expect(titles[1]).toContain("Incident ที่ยังเปิดอยู่");
    expect(titles[2]).toContain("Config รออนุมัติ");
    expect(titles[3]).toContain("Rollout รออนุมัติ");
    expect(queue.getByText("Rollout รออนุมัติ").closest("a")).toHaveAttribute(
      "href",
      "/approvals",
    );
  });

  it("ไม่มีงานค้างเลย: บอกว่าเรียบร้อย ไม่ปล่อยการ์ดว่าง", () => {
    state.paused = q([]);
    state.incidents = q([]);
    render(<DashboardSummary />);

    expect(within(queueCard()).getByText("ไม่มีงานค้างตอนนี้")).toBeInTheDocument();
  });

  it("ลิงก์ตรงกับหน้าปลายทาง: ออฟไลน์กรองไว้, Config ไม่ตรงไม่เป็นลิงก์", () => {
    render(<DashboardSummary />);

    expect(health("อุปกรณ์ออฟไลน์").querySelector("a")).toHaveAttribute(
      "href",
      "/devices?connection=offline",
    );
    expect(health("อุปกรณ์ที่ Config ยังไม่อัปเดต").querySelector("a")).toBeNull();
  });

  it("สถานะอุปกรณ์: ตัวเลขแยกออนไลน์ ออฟไลน์ ไม่ทราบ และ Config ไม่ตรง", () => {
    render(<DashboardSummary />);

    const fleet = within(panel("สถานะอุปกรณ์"));
    expect(fleet.getByText("ออนไลน์").nextSibling?.textContent).toBe("1");
    expect(fleet.getByText("ออฟไลน์").nextSibling?.textContent).toBe("1");
    expect(fleet.getByText("ไม่ทราบ").nextSibling?.textContent).toBe("1");
    expect(fleet.getByText("Config ไม่ตรง").nextSibling?.textContent).toBe("1");
    // วงแหวนบอกสัดส่วนออนไลน์: 1 จาก 3 เครื่อง
    expect(fleet.getByText("33%")).toBeInTheDocument();
  });

  it("กริดจุด LED: 1 เครื่อง 1 จุด เรียงเครื่องที่ต้องสนใจขึ้นก่อน และกดเปิดหน้าเครื่องได้", () => {
    render(<DashboardSummary />);

    const dots = within(
      within(panel("สถานะอุปกรณ์")).getByRole("list", { name: "อุปกรณ์ทั้งหมด" }),
    ).getAllByRole("link");
    expect(dots).toHaveLength(3);
    // BOX-2: ออฟไลน์ + Config ไม่ตรง มาก่อน, ตามด้วยไม่ทราบ (BOX-3), ปกติ (BOX-1) ท้ายสุด
    expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual([
      "BOX-2 · ออฟไลน์ · Config ไม่ตรง",
      "BOX-3 · ไม่ทราบ",
      "BOX-1 · ออนไลน์",
    ]);
    expect(dots[0]).toHaveAttribute("href", "/devices/BOX-2");
  });

  it("ผลการ Deploy รวมเฉพาะ Rollout ที่ปล่อยแล้ว และแสดง % ความสำเร็จ", () => {
    render(<DashboardSummary />);

    const deploy = within(panel("ผลการ Deploy"));
    expect(deploy.getByText("สำเร็จ").nextSibling?.textContent).toBe("5");
    expect(deploy.getByText("ล้มเหลว").nextSibling?.textContent).toBe("1");
    expect(deploy.getByText("83%")).toBeInTheDocument();
  });

  it("ล้มเหลวเกินเกณฑ์ 5%: เตือนพร้อมลิงก์ไป Campaign", () => {
    render(<DashboardSummary />);

    const warning = within(panel("ผลการ Deploy")).getByText(/เกณฑ์ 5%/);
    expect(warning.closest("a")).toHaveAttribute("href", "/campaigns");
  });

  it("ยังไม่มีการ Deploy เลย: บอกตรงๆ ไม่วาดแท่งเปล่า", () => {
    state.allRollouts = q([]);
    render(<DashboardSummary />);

    expect(screen.getByText("ยังไม่มีการ Deploy")).toBeInTheDocument();
  });

  it("Server กลางติดต่อไม่ได้: แถวที่พึ่ง Server กลางบอกว่าไม่ทราบ ไม่แสดงเลข 0 ที่ดูเหมือนปกติ", () => {
    state.central = q({
      mode: "real",
      reachable: false,
      error: "x",
      fetchedAt: "",
      devices: [],
    });
    render(<DashboardSummary />);

    expect(within(health("อุปกรณ์ออฟไลน์")).getByText("ไม่ทราบ")).toBeInTheDocument();
    expect(
      within(health("อุปกรณ์ที่ Config ยังไม่อัปเดต")).getByText("ไม่ทราบ"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ติดต่อ Server กลางไม่ได้ตอนนี้ จึงยังไม่ทราบสถานะการเชื่อมต่อ/),
    ).toBeInTheDocument();
    // คิวงานไม่กระทบ
    expect(within(queueCard()).getByText("Incident ที่ยังเปิดอยู่")).toBeInTheDocument();
  });

  it("Server กลางอยู่ในโหมด mock: มีแถบแจ้งข้อมูลตัวอย่างระดับหน้า (ซื่อตรงว่าเป็นข้อมูลตัวอย่าง)", () => {
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

  // รีวิว #373 (B): FirmwareEngineer/QAEngineer ไม่มีสิทธิ์ `campaign:Read` —
  // ส่วนที่พึ่งข้อมูล Campaign ควรหายไปเงียบๆ ไม่ใช่โชว์ error 403
  describe("role ที่ไม่มีสิทธิ์ campaign:Read", () => {
    it.each(["FirmwareEngineer", "QAEngineer"])(
      "%s ไม่เห็นส่วนที่พึ่งข้อมูล Campaign เลย",
      (role) => {
        state.role = role;
        render(<DashboardSummary />);

        expect(screen.queryByText("ผลการ Deploy")).not.toBeInTheDocument();
        expect(screen.queryByText("Rollout ที่กำลังดำเนินการ")).not.toBeInTheDocument();
        // สถานะระบบที่ไม่พึ่ง Campaign ยังอยู่ตามปกติ
        expect(within(health("Incident ที่ยังเปิดอยู่")).getByText("2")).toBeInTheDocument();
        expect(within(health("อุปกรณ์ทั้งหมด")).getByText("3")).toBeInTheDocument();
      },
    );

    it("role ที่มีสิทธิ์ (เช่น ST) ยังเห็นผลการ Deploy และ Rollout", () => {
      state.role = "ST";
      render(<DashboardSummary />);

      expect(screen.getByText("ผลการ Deploy")).toBeInTheDocument();
      expect(screen.getByText("Rollout ที่กำลังดำเนินการ")).toBeInTheDocument();
    });
  });

  describe("คิวงานเฉพาะ Role", () => {
    it("ConfigEngineer เห็นเฉพาะ Config ของตัวเองที่ถูกปฏิเสธ/ยังเป็นฉบับร่าง", () => {
      state.role = "ConfigEngineer";
      state.userId = "me";
      state.configs = q([
        { id: "a", name: "ของฉัน", status: "rejected", createdBy: "me", createdAt: "", updatedAt: "" },
        { id: "b", name: "ของคนอื่น", status: "rejected", createdBy: "other", createdAt: "", updatedAt: "" },
        { id: "c", name: "ร่าง", status: "draft", createdBy: "me", createdAt: new Date().toISOString(), updatedAt: "" },
      ]);
      render(<DashboardSummary />);

      const queue = within(queueCard());
      const rejected = queue.getByText("Config ที่ถูกปฏิเสธ").closest("a");
      expect(rejected).toHaveAttribute("href", "/config/a");
      expect(within(rejected as HTMLElement).getByText("1")).toBeInTheDocument();
      expect(queue.getByText("Config ฉบับร่างที่ยังไม่ส่งอนุมัติ")).toBeInTheDocument();
    });

    it("QAEngineer เห็น Firmware รอตรวจทุกตัว", () => {
      state.role = "QAEngineer";
      const fw = (id: string, approvalStatus: string) => ({
        id,
        approvalStatus,
        uploadedBy: "u",
        uploadedAt: new Date().toISOString(),
        version: id,
        deviceModelCompatibility: [],
      });
      state.firmware = q([fw("1", "pending_review"), fw("2", "pending_review"), fw("3", "approved")]);
      render(<DashboardSummary />);

      const row = within(queueCard()).getByText("Firmware รอตรวจคุณภาพ").closest("a");
      expect(within(row as HTMLElement).getByText("2")).toBeInTheDocument();
    });

    it("Auditor ไม่มีคิวงาน ใช้กิจกรรมล่าสุดนำแทน", () => {
      state.role = "Auditor";
      render(<DashboardSummary />);

      expect(screen.queryByText("งานที่ต้องดำเนินการ")).not.toBeInTheDocument();
      expect(screen.getByText("กิจกรรมล่าสุด")).toBeInTheDocument();
    });
  });
});
