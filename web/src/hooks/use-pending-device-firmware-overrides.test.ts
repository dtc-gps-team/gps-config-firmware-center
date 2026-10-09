import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { usePendingDeviceFirmwareOverrides } from "./use-pending-device-firmware-overrides";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const listDeviceFirmwareOverridesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/device-firmware-override-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/device-firmware-override-api")
  >("@/lib/device-firmware-override-api");
  return {
    ...actual,
    listDeviceFirmwareOverrides: listDeviceFirmwareOverridesMock,
  };
});

/**
 * PR #278 review ข้อ 1 — mirror
 * `use-pending-device-config-overrides.test.ts` ทุกประการ
 */
describe("usePendingDeviceFirmwareOverrides", () => {
  it("enabled=false -> ไม่เรียก listDeviceFirmwareOverrides เลย, isLoading=false ทันที", () => {
    listDeviceFirmwareOverridesMock.mockClear();

    const { result } = renderHook(() =>
      usePendingDeviceFirmwareOverrides(false),
    );

    expect(listDeviceFirmwareOverridesMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("enabled=true (default) -> เรียก listDeviceFirmwareOverrides(token, { status: 'pending' }) ตามปกติ", async () => {
    listDeviceFirmwareOverridesMock.mockClear();
    listDeviceFirmwareOverridesMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => usePendingDeviceFirmwareOverrides());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listDeviceFirmwareOverridesMock).toHaveBeenCalledWith("tok", {
      status: "pending",
    });
  });
});
