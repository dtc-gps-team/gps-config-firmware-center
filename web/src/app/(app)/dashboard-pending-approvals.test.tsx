import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardPendingApprovals } from "./dashboard-pending-approvals";
import type { PendingApproval } from "@/hooks/use-pending-approvals";
import type { PendingCampaignRolloutApproval } from "@/hooks/use-pending-campaign-rollouts";
import type { DeviceConfigOverride } from "@/lib/device-config-override-api";
import type { DeviceFirmwareOverride } from "@/lib/device-firmware-override-api";

const authState = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { accessToken: "tok", role: authState.role },
  }),
}));

const configsState = vi.hoisted(() => ({
  data: null as PendingApproval[] | null,
  isLoading: true,
  error: null as string | null,
  refetch: vi.fn(),
}));
const rolloutsState = vi.hoisted(() => ({
  data: null as PendingCampaignRolloutApproval[] | null,
  isLoading: true,
  error: null as string | null,
  refetch: vi.fn(),
}));
const overridesState = vi.hoisted(() => ({
  data: null as DeviceConfigOverride[] | null,
  isLoading: true,
  error: null as string | null,
  refetch: vi.fn(),
}));
const firmwareOverridesState = vi.hoisted(() => ({
  data: null as DeviceFirmwareOverride[] | null,
  isLoading: true,
  error: null as string | null,
  refetch: vi.fn(),
}));

const usePendingApprovalsMock = vi.hoisted(() => vi.fn(() => configsState));
const usePendingCampaignRolloutsMock = vi.hoisted(() =>
  vi.fn(() => rolloutsState),
);
const usePendingDeviceConfigOverridesMock = vi.hoisted(() =>
  vi.fn(() => overridesState),
);
const usePendingDeviceFirmwareOverridesMock = vi.hoisted(() =>
  vi.fn(() => firmwareOverridesState),
);

vi.mock("@/hooks/use-pending-approvals", () => ({
  usePendingApprovals: usePendingApprovalsMock,
}));
vi.mock("@/hooks/use-pending-campaign-rollouts", () => ({
  usePendingCampaignRollouts: usePendingCampaignRolloutsMock,
}));
vi.mock("@/hooks/use-pending-device-config-overrides", () => ({
  usePendingDeviceConfigOverrides: usePendingDeviceConfigOverridesMock,
}));
vi.mock("@/hooks/use-pending-device-firmware-overrides", () => ({
  usePendingDeviceFirmwareOverrides: usePendingDeviceFirmwareOverridesMock,
}));

function resetState() {
  configsState.data = null;
  configsState.isLoading = true;
  configsState.error = null;
  rolloutsState.data = null;
  rolloutsState.isLoading = true;
  rolloutsState.error = null;
  overridesState.data = null;
  overridesState.isLoading = true;
  overridesState.error = null;
  firmwareOverridesState.data = null;
  firmwareOverridesState.isLoading = true;
  firmwareOverridesState.error = null;
  vi.clearAllMocks();
}

function makeConfig(overrides: Partial<PendingApproval>): PendingApproval {
  return {
    id: "cfg-1",
    name: "Config A",
    deviceModel: "GT06N",
    protocol: "TCP",
    createdBy: "eng-1",
    description: null,
    fields: {},
    queuedAt: "2026-01-01T00:00:00Z",
    suggestedApprover: null,
    ...overrides,
  };
}

function makeOverride(
  overrides: Partial<DeviceConfigOverride>,
): DeviceConfigOverride {
  return {
    id: "ov-1",
    deviceId: "DEV-0001",
    configId: "cfg-1",
    versionNumber: 1,
    fields: {},
    reason: "ทดสอบ",
    status: "pending",
    overriddenBy: "st-1",
    overriddenAt: "2026-01-02T00:00:00Z",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

function makeFirmwareOverride(
  overrides: Partial<DeviceFirmwareOverride>,
): DeviceFirmwareOverride {
  return {
    id: "fov-1",
    deviceId: "DEV-0001",
    firmwareId: "fw-1",
    versionNumber: 1,
    reason: "ทดสอบ",
    status: "pending",
    overriddenBy: "st-1",
    overriddenAt: "2026-01-02T00:00:00Z",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

describe("DashboardPendingApprovals — role gate (#251 review comment B ข้อ 1)", () => {
  it("role ไม่ใช่ Operation -> ไม่ render อะไรเลย และไม่เรียก hook คิวรออนุมัติสักตัว", () => {
    resetState();
    authState.role = "ST";

    const { container } = render(<DashboardPendingApprovals />);

    expect(container).toBeEmptyDOMElement();
    expect(usePendingApprovalsMock).not.toHaveBeenCalled();
    expect(usePendingCampaignRolloutsMock).not.toHaveBeenCalled();
    expect(usePendingDeviceConfigOverridesMock).not.toHaveBeenCalled();
    expect(usePendingDeviceFirmwareOverridesMock).not.toHaveBeenCalled();
  });

  it("role Operation -> render widget และเรียกทั้ง 4 hook", () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [];
    configsState.isLoading = false;
    rolloutsState.data = [];
    rolloutsState.isLoading = false;
    overridesState.data = [];
    overridesState.isLoading = false;
    firmwareOverridesState.data = [];
    firmwareOverridesState.isLoading = false;

    const { container } = render(<DashboardPendingApprovals />);

    expect(container.textContent).toContain("รายการรออนุมัติ");
    expect(usePendingApprovalsMock).toHaveBeenCalled();
    expect(usePendingCampaignRolloutsMock).toHaveBeenCalled();
    expect(usePendingDeviceConfigOverridesMock).toHaveBeenCalled();
    expect(usePendingDeviceFirmwareOverridesMock).toHaveBeenCalled();
  });
});

describe("DashboardPendingApprovals — รวม 3 คิว เรียงเวลา cap 5 (#251 review comment B ข้อ 3)", () => {
  it("รวมรายการจากทั้ง 3 ประเภท เรียงใหม่สุดก่อน และตัดเหลือ 5 รายการ", () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [
      makeConfig({ id: "cfg-1", name: "Config เก่าสุด", queuedAt: "2026-01-01T00:00:00Z" }),
      makeConfig({ id: "cfg-2", name: "Config ใหม่สุด", queuedAt: "2026-01-10T00:00:00Z" }),
    ];
    configsState.isLoading = false;
    rolloutsState.data = [
      {
        rollout: {
          id: "rollout-1",
          campaignId: "campaign-1",
          payloadType: "Config",
          configId: "cfg-1",
          firmwareId: null,
          status: "pending_approval",
          targetCount: 1,
          successCount: 0,
          failureCount: 0,
          createdBy: "op-1",
          approvedBy: null,
          approvedAt: null,
          isRollback: false,
          rollbackOfId: null,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
        },
        campaignName: "กลุ่มทดสอบ",
      },
    ];
    rolloutsState.isLoading = false;
    overridesState.data = [
      makeOverride({ id: "ov-1", deviceId: "DEV-0001", overriddenAt: "2026-01-03T00:00:00Z" }),
      makeOverride({ id: "ov-2", deviceId: "DEV-0002", overriddenAt: "2026-01-04T00:00:00Z" }),
      makeOverride({ id: "ov-3", deviceId: "DEV-0003", overriddenAt: "2026-01-06T00:00:00Z" }),
    ];
    overridesState.isLoading = false;
    firmwareOverridesState.data = [];
    firmwareOverridesState.isLoading = false;

    const { container } = render(<DashboardPendingApprovals />);

    // รวม 6 รายการ (2+1+3+0) แต่ cap ไว้ที่ 5 -> ตัวที่เก่าสุด (Config เก่าสุด
    // 2026-01-01) หลุดออกไป
    expect(container.textContent).toContain("รายการรออนุมัติ");
    expect(container.textContent).toContain("(6)");
    expect(screen.queryByText("Config เก่าสุด")).not.toBeInTheDocument();
    expect(screen.getByText("Config ใหม่สุด")).toBeInTheDocument();
    expect(screen.getByText("กลุ่มทดสอบ")).toBeInTheDocument();
    expect(screen.getByText("DEV-0003")).toBeInTheDocument();
  });
});

describe("DashboardPendingApprovals — Firmware Override รวมเข้า unified list (Sprint 3 แถวที่ 24)", () => {
  it("มีคำขอ firmware-override -> ขึ้นในลิสต์พร้อมปุ่มอนุมัติ/ปฏิเสธ", () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [];
    configsState.isLoading = false;
    rolloutsState.data = [];
    rolloutsState.isLoading = false;
    overridesState.data = [];
    overridesState.isLoading = false;
    firmwareOverridesState.data = [makeFirmwareOverride({ id: "fov-1", deviceId: "DEV-0099" })];
    firmwareOverridesState.isLoading = false;

    const { container } = render(<DashboardPendingApprovals />);

    expect(container.textContent).toContain("(1)");
    expect(screen.getByText("DEV-0099")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
  });
});

describe("DashboardPendingApprovals — loading/error (#251 review comment B ข้อ 2)", () => {
  it("คิวหนึ่งโหลดเสร็จก่อน (ว่าง) อีกสองคิวยังโหลดอยู่ -> ยังแสดง skeleton ไม่ใช่ empty state", () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [];
    configsState.isLoading = false; // โหลดเสร็จก่อน ว่างจริง
    // rolloutsState/overridesState ยังเป็นค่า default (isLoading: true, data: null)

    const { container } = render(<DashboardPendingApprovals />);

    expect(
      screen.queryByText("ไม่มีรายการรออนุมัติตอนนี้"),
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("คิวใดคิวหนึ่งโหลดพัง -> โชว์ error + ปุ่มลองใหม่ ไม่ใช่ 'ไม่มีรายการรออนุมัติ'", async () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [];
    configsState.isLoading = false;
    rolloutsState.data = [];
    rolloutsState.isLoading = false;
    overridesState.data = null;
    overridesState.isLoading = false;
    overridesState.error = "โหลดคิว Override ไม่สำเร็จ";
    firmwareOverridesState.data = [];
    firmwareOverridesState.isLoading = false;

    const user = userEvent.setup();
    render(<DashboardPendingApprovals />);

    expect(
      screen.queryByText("ไม่มีรายการรออนุมัติตอนนี้"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("โหลดคิว Override ไม่สำเร็จ")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));

    expect(configsState.refetch).toHaveBeenCalled();
    expect(rolloutsState.refetch).toHaveBeenCalled();
    expect(overridesState.refetch).toHaveBeenCalled();
    expect(firmwareOverridesState.refetch).toHaveBeenCalled();
  });

  it("ทุกคิวโหลดเสร็จและว่างจริง -> โชว์ 'ไม่มีรายการรออนุมัติตอนนี้'", () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [];
    configsState.isLoading = false;
    rolloutsState.data = [];
    rolloutsState.isLoading = false;
    overridesState.data = [];
    overridesState.isLoading = false;
    firmwareOverridesState.data = [];
    firmwareOverridesState.isLoading = false;

    render(<DashboardPendingApprovals />);

    expect(screen.getByText("ไม่มีรายการรออนุมัติตอนนี้")).toBeInTheDocument();
  });
});
