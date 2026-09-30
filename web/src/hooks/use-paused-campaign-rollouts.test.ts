import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { usePausedCampaignRollouts } from "./use-paused-campaign-rollouts";
import type { CampaignRollout } from "@/lib/campaign-api";

const authState = vi.hoisted(() => ({
  accessToken: "tok" as string | null,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: authState.accessToken
      ? { accessToken: authState.accessToken, role: "Operation" }
      : null,
  }),
}));

const listAllCampaignRolloutsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/campaign-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/campaign-api")>(
    "@/lib/campaign-api",
  );
  return {
    ...actual,
    listAllCampaignRollouts: listAllCampaignRolloutsMock,
  };
});

function makeRollout(overrides: Partial<CampaignRollout>): CampaignRollout {
  return {
    id: "rollout-1",
    campaignId: "campaign-1",
    payloadType: "Config",
    configId: "cfg-1",
    firmwareId: null,
    status: "paused",
    targetCount: 2,
    successCount: 1,
    failureCount: 1,
    createdBy: "op-1",
    approvedBy: "op-1",
    approvedAt: "2026-01-01T00:00:00Z",
    isRollback: false,
    rollbackOfId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("usePausedCampaignRollouts (#238 review comment ข้อ 3)", () => {
  it("เรียก GET /campaigns/rollouts?status=paused และคืนผลลัพธ์", async () => {
    authState.accessToken = "tok";
    const rollouts = [
      makeRollout({ id: "r-1" }),
      makeRollout({ id: "r-2" }),
    ];
    listAllCampaignRolloutsMock.mockResolvedValueOnce(rollouts);

    const { result } = renderHook(() => usePausedCampaignRollouts());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listAllCampaignRolloutsMock).toHaveBeenCalledWith("tok", {
      status: "paused",
    });
    expect(result.current.data).toEqual(rollouts);
    expect(result.current.error).toBeNull();
  });

  it("API ล่ม -> error message, data เดิมไม่หาย (คงเป็น null ถ้ายังไม่เคยโหลดสำเร็จ)", async () => {
    authState.accessToken = "tok";
    listAllCampaignRolloutsMock.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => usePausedCampaignRollouts());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("โหลด Rollout ที่ paused ไม่สำเร็จ");
    expect(result.current.data).toBeNull();
  });

  it("ไม่มี token (ยังไม่ login เสร็จ) -> ไม่เรียก API เลย", () => {
    authState.accessToken = null;
    listAllCampaignRolloutsMock.mockClear();

    const { result } = renderHook(() => usePausedCampaignRollouts());

    expect(listAllCampaignRolloutsMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
  });
});
