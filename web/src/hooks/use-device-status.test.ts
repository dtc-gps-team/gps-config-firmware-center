import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { ApiError } from "@/lib/api";
import { useDeviceStatus } from "./use-device-status";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const getDeviceStatusMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/device-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/device-api")>(
      "@/lib/device-api",
    );
  return { ...actual, getDeviceStatus: getDeviceStatusMock };
});

const status = {
  deviceId: "DEV-0001",
  configStatus: "pending",
  firmwareStatus: "unknown",
  configRolloutId: "11111111-1111-4111-8111-111111111111",
  firmwareRolloutId: null,
  lastCheckInMessage: null,
  pendingFirmwareOverride: null,
};

describe("useDeviceStatus", () => {
  it("เรียก getDeviceStatus(token, deviceId) แล้วคืนข้อมูล", async () => {
    getDeviceStatusMock.mockReset();
    getDeviceStatusMock.mockResolvedValueOnce(status);

    const { result } = renderHook(() => useDeviceStatus("DEV-0001"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getDeviceStatusMock).toHaveBeenCalledWith("tok", "DEV-0001");
    expect(result.current.data).toEqual(status);
    expect(result.current.error).toBeNull();
  });

  it("deviceId เป็น null -> ไม่ยิง API", () => {
    getDeviceStatusMock.mockReset();

    renderHook(() => useDeviceStatus(null));

    expect(getDeviceStatusMock).not.toHaveBeenCalled();
  });

  it("โหลดไม่สำเร็จ -> error เป็นข้อความจาก backend และไม่มีข้อมูล", async () => {
    getDeviceStatusMock.mockReset();
    getDeviceStatusMock.mockRejectedValueOnce(
      new ApiError("ไม่พบอุปกรณ์", 404),
    );

    const { result } = renderHook(() => useDeviceStatus("DEV-0001"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("ไม่พบอุปกรณ์");
    expect(result.current.data).toBeNull();
  });
});
