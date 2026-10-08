import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { usePendingDeviceConfigOverrides } from "./use-pending-device-config-overrides";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const listDeviceConfigOverridesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/device-config-override-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/device-config-override-api")
  >("@/lib/device-config-override-api");
  return {
    ...actual,
    listDeviceConfigOverrides: listDeviceConfigOverridesMock,
  };
});

/**
 * PR #278 review ข้อ 1 — `enabled=false` (role ที่ไม่มีสิทธิ์ Read เช่น
 * Admin) ต้องไม่ยิง request เลย ไม่ใช่แค่ไม่ render — เช็คที่ API function
 * ตรงๆ ว่าไม่ถูกเรียก mirror `use-paused-campaign-rollouts.test.ts`
 */
describe("usePendingDeviceConfigOverrides", () => {
  it("enabled=false -> ไม่เรียก listDeviceConfigOverrides เลย, isLoading=false ทันที", () => {
    listDeviceConfigOverridesMock.mockClear();

    const { result } = renderHook(() => usePendingDeviceConfigOverrides(false));

    expect(listDeviceConfigOverridesMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("enabled=true (default) -> เรียก listDeviceConfigOverrides(token, { status: 'pending' }) ตามปกติ", async () => {
    listDeviceConfigOverridesMock.mockClear();
    listDeviceConfigOverridesMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => usePendingDeviceConfigOverrides());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listDeviceConfigOverridesMock).toHaveBeenCalledWith("tok", {
      status: "pending",
    });
  });
});
