import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useDeviceCentral } from "./use-central-devices";

const authState = vi.hoisted(() => ({ token: "tok" as string | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: authState.token
      ? { accessToken: authState.token, role: "ST" }
      : null,
  }),
}));

const getDeviceCentralMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/central-device-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/central-device-api")
  >("@/lib/central-device-api");
  return { ...actual, getDeviceCentral: getDeviceCentralMock };
});

const view = (deviceId: string) => ({
  mode: "real",
  reachable: true,
  error: null,
  fetchedAt: "2026-10-20T00:00:00.000Z",
  device: { deviceId },
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useDeviceCentral", () => {
  beforeEach(() => {
    authState.token = "tok";
    getDeviceCentralMock.mockReset();
  });

  it("ไม่มี token: ไม่ยิง API และไม่ค้างสถานะกำลังโหลด", () => {
    authState.token = null;

    const { result } = renderHook(() => useDeviceCentral("BOX-1"));

    expect(getDeviceCentralMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("โหลดสำเร็จ: คืนข้อมูลของเครื่องที่ขอ", async () => {
    getDeviceCentralMock.mockResolvedValue(view("BOX-1"));

    const { result } = renderHook(() => useDeviceCentral("BOX-1"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getDeviceCentralMock).toHaveBeenCalledWith("tok", "BOX-1");
    expect(result.current.data).toEqual(view("BOX-1"));
  });

  it("เปลี่ยนเครื่องระหว่างที่คำขอเก่ายังไม่ตอบ: ผลของเครื่องเก่าที่มาช้าต้องไม่เขียนทับผลของเครื่องใหม่", async () => {
    const slowOld = deferred<ReturnType<typeof view>>();
    getDeviceCentralMock.mockImplementation((_t: string, id: string) =>
      id === "OLD" ? slowOld.promise : Promise.resolve(view(id)),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDeviceCentral(id),
      { initialProps: { id: "OLD" } },
    );
    rerender({ id: "NEW" });
    await waitFor(() => expect(result.current.data).toEqual(view("NEW")));

    // คำขอของเครื่องเก่าตอบกลับทีหลัง
    await act(async () => {
      slowOld.resolve(view("OLD"));
      await Promise.resolve();
    });

    expect(result.current.data).toEqual(view("NEW"));
  });

  it("เปลี่ยนเครื่อง: ไม่แสดงข้อมูลของเครื่องเก่าระหว่างรอผลของเครื่องใหม่", async () => {
    const slowNew = deferred<ReturnType<typeof view>>();
    getDeviceCentralMock.mockImplementation((_t: string, id: string) =>
      id === "NEW" ? slowNew.promise : Promise.resolve(view(id)),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDeviceCentral(id),
      { initialProps: { id: "OLD" } },
    );
    await waitFor(() => expect(result.current.data).toEqual(view("OLD")));

    rerender({ id: "NEW" });

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });
});
