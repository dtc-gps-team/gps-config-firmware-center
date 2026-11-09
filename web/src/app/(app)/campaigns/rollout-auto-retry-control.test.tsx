import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Campaign } from "@/lib/campaign-api";
import { RolloutAutoRetryControl } from "./rollout-auto-retry-control";

const auth = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: auth.role } }),
}));

const campaignState = vi.hoisted(() => ({
  data: null as unknown,
  refetch: vi.fn(),
}));
vi.mock("@/hooks/use-campaign", () => ({
  useCampaign: () => ({
    data: campaignState.data,
    isLoading: false,
    error: null,
    refetch: campaignState.refetch,
  }),
}));

const updateMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/campaign-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/campaign-api")>(
      "@/lib/campaign-api",
    );
  return { ...actual, updateCampaign: updateMock };
});

function campaign(autoRetry: boolean): Campaign {
  return {
    id: "c-1",
    name: "กลุ่มทดสอบ",
    description: null,
    autoRetry,
    createdBy: "op-1",
    createdAt: "2026-11-09T00:00:00Z",
    updatedAt: "2026-11-09T00:00:00Z",
  };
}

beforeEach(() => {
  auth.role = "Operation";
  campaignState.data = campaign(true);
  campaignState.refetch.mockReset().mockResolvedValue(undefined);
  updateMock.mockReset().mockResolvedValue(campaign(false));
});

describe("RolloutAutoRetryControl", () => {
  it("แสดงสถานะ เปิด และสวิตช์ เมื่อ Operation ดู Rollout ที่ยัง active", () => {
    render(<RolloutAutoRetryControl campaignId="c-1" rolloutStatus="active" />);

    expect(screen.getByText("ลองส่งใหม่อัตโนมัติ")).toBeInTheDocument();
    expect(screen.getByText("เปิด")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "ลองส่งใหม่อัตโนมัติ" }),
    ).toBeChecked();
  });

  it("ปิด: ต้องยืนยันก่อน แล้วเรียก PATCH autoRetry=false และโหลดกลุ่มใหม่", async () => {
    const user = userEvent.setup();
    render(<RolloutAutoRetryControl campaignId="c-1" rolloutStatus="paused" />);

    await user.click(
      screen.getByRole("switch", { name: "ลองส่งใหม่อัตโนมัติ" }),
    );
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/จะจบด้วยผลของรอบล่าสุด/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ยืนยันปิด" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("tok", "c-1", {
        autoRetry: false,
      }),
    );
    await waitFor(() => expect(campaignState.refetch).toHaveBeenCalled());
  });

  it("ตอนปิดอยู่: สวิตช์เปิดกดแล้วเรียก PATCH autoRetry=true ทันที ไม่ต้องยืนยัน", async () => {
    campaignState.data = campaign(false);
    const user = userEvent.setup();
    render(<RolloutAutoRetryControl campaignId="c-1" rolloutStatus="active" />);
    expect(screen.getByText("ปิด")).toBeInTheDocument();

    await user.click(
      screen.getByRole("switch", { name: "ลองส่งใหม่อัตโนมัติ" }),
    );

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("tok", "c-1", {
        autoRetry: true,
      }),
    );
  });

  it("Rollout จบแล้ว: แสดงสถานะอย่างเดียว ไม่มีสวิตช์", () => {
    render(
      <RolloutAutoRetryControl campaignId="c-1" rolloutStatus="completed" />,
    );

    expect(screen.getByText("เปิด")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("role ที่ไม่ใช่ Operation หรือ SuperAdmin: แสดงสถานะอย่างเดียว ไม่มีสวิตช์", () => {
    auth.role = "Auditor";
    render(<RolloutAutoRetryControl campaignId="c-1" rolloutStatus="active" />);

    expect(screen.getByText("เปิด")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("บันทึกไม่สำเร็จ: แสดงข้อความผิดพลาดในกล่องยืนยัน ไม่ปิดกล่อง", async () => {
    updateMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<RolloutAutoRetryControl campaignId="c-1" rolloutStatus="active" />);

    await user.click(
      screen.getByRole("switch", { name: "ลองส่งใหม่อัตโนมัติ" }),
    );
    await user.click(screen.getByRole("button", { name: "ยืนยันปิด" }));

    await waitFor(() =>
      expect(screen.getByText("บันทึกไม่สำเร็จ")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "ยืนยันปิด" }),
    ).toBeInTheDocument();
  });
});
