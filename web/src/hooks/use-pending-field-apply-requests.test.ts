import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { usePendingFieldApplyRequests } from "./use-pending-field-apply-requests";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const listFieldApplyRequestsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/field-apply-request-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/field-apply-request-api")
  >("@/lib/field-apply-request-api");
  return {
    ...actual,
    listFieldApplyRequests: listFieldApplyRequestsMock,
  };
});

/** mirror use-pending-device-config-overrides.test.ts (PR #278 review ข้อ 1)
 * — role ที่ไม่มีสิทธิ์ Approve ต้องไม่ยิง request เลย ไม่ใช่แค่ไม่ render */
describe("usePendingFieldApplyRequests", () => {
  it("enabled=false -> ไม่เรียก listFieldApplyRequests เลย, isLoading=false ทันที", () => {
    listFieldApplyRequestsMock.mockClear();

    const { result } = renderHook(() => usePendingFieldApplyRequests(false));

    expect(listFieldApplyRequestsMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("enabled=true (default) -> เรียก listFieldApplyRequests(token, { status: 'pending' }) ตามปกติ", async () => {
    listFieldApplyRequestsMock.mockClear();
    listFieldApplyRequestsMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => usePendingFieldApplyRequests());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listFieldApplyRequestsMock).toHaveBeenCalledWith("tok", {
      status: "pending",
    });
  });
});
