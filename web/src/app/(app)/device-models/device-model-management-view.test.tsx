import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { DeviceModelManagementView } from "./device-model-management-view";
import type { DeviceModel } from "@/lib/device-model-api";

const authState = vi.hoisted(() => ({
  role: "Admin" as string | null,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    isReady: true,
    session: { accessToken: "tok", role: authState.role },
  }),
}));

const sampleModel: DeviceModel = {
  id: "dm-1",
  name: "GT06N",
  manufacturer: null,
  supportedProtocols: ["TCP"],
  status: "active",
  warrantyMonths: null,
  endOfSupportDate: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

vi.mock("@/hooks/use-device-models", () => ({
  useDeviceModels: () => ({
    data: [sampleModel],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

/**
 * PR #273 review ข้อ 1(ก) — role ที่ไม่ใช่ Admin/SuperAdmin ต้องถูก RoleGuard
 * บล็อกทั้งหน้า (ไม่ใช่แค่ซ่อนปุ่ม) mirror pattern เดียวกับ Audit Log/User
 * Management ตาม comment ใน role-guard.tsx
 */
describe("DeviceModelManagementView — RoleGuard", () => {
  it("role ที่ไม่มีสิทธิ์ (เช่น ConfigEngineer) เห็นข้อความ 'ไม่มีสิทธิ์' แทนตาราง", () => {
    authState.role = "ConfigEngineer";
    render(<DeviceModelManagementView />);

    expect(screen.getByText("คุณไม่มีสิทธิ์เข้าถึงหน้านี้")).toBeInTheDocument();
    expect(screen.queryByText("Device Model Management")).not.toBeInTheDocument();
    expect(screen.queryByText("GT06N")).not.toBeInTheDocument();
  });

  it("Admin เห็นหน้าปกติ (ตาราง + ปุ่มเพิ่มรุ่นอุปกรณ์)", () => {
    authState.role = "Admin";
    render(<DeviceModelManagementView />);

    expect(screen.getByText("Device Model Management")).toBeInTheDocument();
    expect(screen.getByText("GT06N")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ เพิ่มรุ่นอุปกรณ์" }),
    ).toBeInTheDocument();
  });

  it("SuperAdmin เห็นหน้าปกติเหมือน Admin", () => {
    authState.role = "SuperAdmin";
    render(<DeviceModelManagementView />);

    expect(screen.getByText("Device Model Management")).toBeInTheDocument();
  });
});
