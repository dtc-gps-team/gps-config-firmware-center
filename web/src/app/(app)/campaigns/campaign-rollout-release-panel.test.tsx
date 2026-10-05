import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CampaignRolloutReleasePanel } from "./campaign-rollout-release-panel";
import type { CampaignRollout } from "@/lib/campaign-api";

const authState = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { accessToken: "tok", role: authState.role },
  }),
}));

const releaseMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/campaign-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/campaign-api")>(
    "@/lib/campaign-api",
  );
  return {
    ...actual,
    releaseCampaignRollout: releaseMock,
  };
});

function makeRollout(overrides: Partial<CampaignRollout>): CampaignRollout {
  return {
    id: "rollout-1",
    campaignId: "campaign-1",
    payloadType: "Config",
    configId: "cfg-1",
    firmwareId: null,
    status: "approved",
    targetCount: 2,
    successCount: 0,
    failureCount: 0,
    createdBy: "op-1",
    approvedBy: "op-2",
    approvedAt: "2026-01-01T00:00:00Z",
    isRollback: false,
    rollbackOfId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("CampaignRolloutReleasePanel — แสดงตาม status/role", () => {
  it("status ไม่ใช่ approved -> ไม่ render อะไรเลย", () => {
    authState.role = "Operation";
    const { container } = render(
      <CampaignRolloutReleasePanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "pending_approval" })}
        onReleased={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("status approved + role ไม่ใช่ Operation -> เห็นข้อความรอ ไม่เห็นปุ่ม", () => {
    authState.role = "ST";
    render(
      <CampaignRolloutReleasePanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "approved" })}
        onReleased={vi.fn()}
      />,
    );

    expect(screen.getByText("รอ Operation ปล่อยเข้าอุปกรณ์")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ปล่อยเข้าอุปกรณ์" }),
    ).not.toBeInTheDocument();
  });

  it("status approved + role Operation (รวมถึงผู้อนุมัติเดิมเอง) -> เห็นปุ่มปล่อยเข้าอุปกรณ์", () => {
    authState.role = "Operation";
    render(
      <CampaignRolloutReleasePanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "approved", approvedBy: "op-1" })}
        onReleased={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "ปล่อยเข้าอุปกรณ์" }),
    ).toBeInTheDocument();
  });
});

describe("CampaignRolloutReleasePanel — flow ยืนยัน 2 ขั้น", () => {
  it("กดปล่อยเข้าอุปกรณ์ -> ขึ้นยืนยัน -> กดยืนยัน -> เรียก releaseCampaignRollout แล้วเรียก onReleased", async () => {
    const user = userEvent.setup();
    authState.role = "Operation";
    const released = makeRollout({ status: "active" });
    releaseMock.mockResolvedValueOnce(released);
    const onReleased = vi.fn();

    render(
      <CampaignRolloutReleasePanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "approved" })}
        onReleased={onReleased}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ปล่อยเข้าอุปกรณ์" }));
    expect(
      screen.getByText("ปล่อย Rollout นี้เข้าอุปกรณ์เลยหรือไม่?"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "ยืนยันปล่อยเข้าอุปกรณ์" }),
    );

    expect(releaseMock).toHaveBeenCalledWith("tok", "campaign-1", "rollout-1");
    expect(onReleased).toHaveBeenCalledWith(released);
  });

  it("กดยกเลิกระหว่างยืนยัน -> กลับไปปุ่มเดิม ไม่เรียก API", async () => {
    const user = userEvent.setup();
    authState.role = "Operation";

    render(
      <CampaignRolloutReleasePanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "approved" })}
        onReleased={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ปล่อยเข้าอุปกรณ์" }));
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));

    expect(
      screen.getByRole("button", { name: "ปล่อยเข้าอุปกรณ์" }),
    ).toBeInTheDocument();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("releaseCampaignRollout ล้มเหลว -> ขึ้น error กลับไปปุ่มเดิม", async () => {
    const user = userEvent.setup();
    authState.role = "Operation";
    releaseMock.mockRejectedValueOnce(new Error("network error"));

    render(
      <CampaignRolloutReleasePanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "approved" })}
        onReleased={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ปล่อยเข้าอุปกรณ์" }));
    await user.click(
      screen.getByRole("button", { name: "ยืนยันปล่อยเข้าอุปกรณ์" }),
    );

    expect(await screen.findByText("ปล่อยเข้าอุปกรณ์ไม่สำเร็จ")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ปล่อยเข้าอุปกรณ์" }),
    ).toBeInTheDocument();
  });
});
