import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useUserNames } from "./use-user-names";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Admin" } }),
}));

const listUsersMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/users-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/users-api")>(
    "@/lib/users-api",
  );
  return {
    ...actual,
    listUsers: listUsersMock,
  };
});

describe("useUserNames", () => {
  it("resolve userId ที่เจอใน GET /users เป็นชื่อเต็ม", async () => {
    listUsersMock.mockResolvedValueOnce([
      { id: "user-1", fullName: "Config Engineer Tester", role: "ConfigEngineer" },
      { id: "user-2", fullName: "Operation Tester", role: "Operation" },
    ]);

    const { result } = renderHook(() => useUserNames());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.resolveName("user-1")).toBe("Config Engineer Tester");
    expect(result.current.resolveName("user-2")).toBe("Operation Tester");
  });

  it("userId ที่ไม่เจอ (บัญชีถูกปิดใช้งานไปแล้ว) -> fallback คืน id เดิม", async () => {
    listUsersMock.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useUserNames());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.resolveName("unknown-id")).toBe("unknown-id");
  });

  it("GET /users ล่ม -> ไม่ throw, resolveName fallback เป็น id เดิม", async () => {
    listUsersMock.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useUserNames());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.resolveName("user-1")).toBe("user-1");
  });
});
