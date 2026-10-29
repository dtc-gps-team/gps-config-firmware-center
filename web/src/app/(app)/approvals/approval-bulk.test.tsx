import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApprovalCenterView } from "./approval-center-view";

const approveConfig = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));
vi.mock("@/lib/jwt", () => ({ getTokenSubject: () => "me" }));
vi.mock("@/lib/config-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/config-api")>()),
  approveConfig,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function item(id: string, createdBy: string) {
  return {
    id,
    name: `cfg-${id}`,
    deviceModel: "GT06N",
    protocol: "TCP",
    createdBy,
    description: null,
    fields: { A: 1 },
    queuedAt: new Date().toISOString(),
    suggestedApprover: null,
  };
}

vi.mock("@/hooks/use-pending-approvals", () => ({
  usePendingApprovals: () => ({
    data: [item("1", "other"), item("2", "other"), item("3", "me")],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-pending-campaign-rollouts", () => ({
  usePendingCampaignRollouts: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-pending-device-config-overrides", () => ({
  usePendingDeviceConfigOverrides: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-pending-device-firmware-overrides", () => ({
  usePendingDeviceFirmwareOverrides: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-config-versions", () => ({
  useConfigVersions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({ resolveName: (id: string) => id }),
}));

describe("Approval Center bulk approve", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/approvals");
    approveConfig.mockReset();
    approveConfig.mockResolvedValue({});
  });

  it("เลือกทั้งหมดข้าม Config ของตัวเอง และต้องพิมพ์ APPROVE ก่อนอนุมัติ", async () => {
    const user = userEvent.setup();
    render(<ApprovalCenterView />);

    // Config ของตัวเอง (id 3) เลือกไม่ได้ (Separation of Duty)
    expect(screen.getByRole("checkbox", { name: "เลือก cfg-3" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(screen.getByRole("checkbox", { name: /เลือกทั้งหมดที่อนุมัติได้/ }));
    expect(screen.getByText("เลือก 2 Config")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "อนุมัติที่เลือก" }));
    const confirm = await screen.findByRole("button", { name: "อนุมัติ 2 รายการ" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByRole("textbox"), "APPROVE");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(approveConfig).toHaveBeenCalledTimes(2));
    expect(approveConfig).toHaveBeenCalledWith("tok", "1");
    expect(approveConfig).toHaveBeenCalledWith("tok", "2");
    expect(approveConfig).not.toHaveBeenCalledWith("tok", "3");
  });

  it("สลับ ทั้งหมด / เจาะจงถึงฉัน แล้ว URL เปลี่ยนตาม", async () => {
    const user = userEvent.setup();
    render(<ApprovalCenterView />);

    await user.click(screen.getByRole("button", { name: /^เจาะจงถึงฉัน \(/ }));
    expect(window.location.search).toBe("?view=mine");
    await user.click(screen.getByRole("button", { name: /^ทั้งหมด \(/ }));
    expect(window.location.search).toBe("");
  });
});
