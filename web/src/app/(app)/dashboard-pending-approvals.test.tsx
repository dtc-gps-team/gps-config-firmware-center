import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

describe("DashboardPendingApprovals — role gate (#251 review comment B ข้อ 1, ยังใช้หลักการเดิม)", () => {
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

  it("role Operation -> เรียกทั้ง 4 hook (แม้ไม่มีรายการ, นับรวมอยู่ดี)", () => {
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

    expect(usePendingApprovalsMock).toHaveBeenCalled();
    expect(usePendingCampaignRolloutsMock).toHaveBeenCalled();
    expect(usePendingDeviceConfigOverridesMock).toHaveBeenCalled();
    expect(usePendingDeviceFirmwareOverridesMock).toHaveBeenCalled();
  });
});

describe("DashboardPendingApprovals — แถบแจ้งเตือน (แก้ครั้งที่ 69 — ลดจาก worklist เต็มรูปแบบ)", () => {
  it("ไม่มีรายการรอเลย (ทุกคิวว่าง) -> ไม่ render อะไรเลย ไม่มี empty state ให้เห็น", () => {
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

    expect(container).toBeEmptyDOMElement();
  });

  it("มีรายการรวมจากหลายคิว -> โชว์แถบแจ้งเตือนพร้อมจำนวนรวม + ลิงก์ไป Approval Center", () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [
      makeConfig({ id: "cfg-1" }),
      makeConfig({ id: "cfg-2" }),
    ];
    configsState.isLoading = false;
    rolloutsState.data = [];
    rolloutsState.isLoading = false;
    overridesState.data = [makeOverride({ id: "ov-1" })];
    overridesState.isLoading = false;
    firmwareOverridesState.data = [];
    firmwareOverridesState.isLoading = false;

    render(<DashboardPendingApprovals />);

    // รวม 2 (config) + 0 (rollout) + 1 (override) + 0 (firmware override) = 3
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/รายการรออนุมัติ/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /ไปที่ Approval Center/ });
    expect(link).toHaveAttribute("href", "/approvals");
  });

  it("ไม่มีปุ่มอนุมัติ/ปฏิเสธ inline อีกต่อไป (ตัดออกตามขอบเขตใหม่)", () => {
    resetState();
    authState.role = "Operation";
    configsState.data = [makeConfig({ id: "cfg-1" })];
    configsState.isLoading = false;
    rolloutsState.data = [];
    rolloutsState.isLoading = false;
    overridesState.data = [];
    overridesState.isLoading = false;
    firmwareOverridesState.data = [];
    firmwareOverridesState.isLoading = false;

    render(<DashboardPendingApprovals />);

    expect(
      screen.queryByRole("button", { name: /อนุมัติ/ }),
    ).not.toBeInTheDocument();
  });
});
