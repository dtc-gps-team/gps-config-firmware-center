import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ApprovalCenterView } from "./approval-center-view";

const authState = vi.hoisted(() => ({ role: "Admin" as string | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { accessToken: "tok", role: authState.role },
  }),
}));

vi.mock("@/hooks/use-pending-approvals", () => ({
  usePendingApprovals: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-pending-campaign-rollouts", () => ({
  usePendingCampaignRollouts: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const usePendingDeviceConfigOverrides = vi.fn();
vi.mock("@/hooks/use-pending-device-config-overrides", () => ({
  usePendingDeviceConfigOverrides: (enabled: boolean) =>
    usePendingDeviceConfigOverrides(enabled),
}));

const usePendingDeviceFirmwareOverrides = vi.fn();
vi.mock("@/hooks/use-pending-device-firmware-overrides", () => ({
  usePendingDeviceFirmwareOverrides: (enabled: boolean) =>
    usePendingDeviceFirmwareOverrides(enabled),
}));

function emptyQueryState() {
  return { data: [], isLoading: false, error: null, refetch: vi.fn() };
}

/**
 * PR #278 review ข้อ 1 — ครอบ gate ใหม่: role ที่ไม่มีสิทธิ์ Read บน
 * device-config-override/device-firmware-override (ทุก role ยกเว้น
 * Operation) ต้องไม่เห็น section + ไม่ยิง request เลย (เช็คที่ arg `enabled`
 * ของ hook ตรงๆ ไม่ต้อง mock fetch) ส่วน Operation ต้องเห็นครบเหมือนเดิม
 */
describe("ApprovalCenterView — permission gate ของ Per-device Config/Firmware Override", () => {
  it("role Admin: ไม่เห็น section Config Override / Firmware Override เลย และ hook ถูกเรียกด้วย enabled=false", () => {
    authState.role = "Admin";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    // ใช้ CardDescription (ข้อความเดี่ยวๆ ไม่มี element ซ้อน) แทน CardTitle
    // กัน getByText match ซ้ำกับ ancestor ที่ textContent รวมลูกเข้าไปด้วย
    expect(
      screen.queryByText(/คำขอแก้ค่าพารามิเตอร์เฉพาะเครื่อง/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/คำขอติดตั้ง Firmware เฉพาะเครื่องที่ไม่ตรงกับ/),
    ).not.toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(false);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(false);

    // section ที่ role ใดก็อ่านได้อยู่แล้ว (Config/Campaign Rollout) ยังต้องเห็นตามปกติ
    expect(
      screen.getByText(/สถานะ Config = testing/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Rollout ที่เพิ่งเริ่มในกลุ่มอุปกรณ์ต่างๆ/),
    ).toBeInTheDocument();
  });

  it("role Operation: เห็นครบทั้ง 4 section เหมือนเดิม และ hook ถูกเรียกด้วย enabled=true", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(
      screen.getByText(/คำขอแก้ค่าพารามิเตอร์เฉพาะเครื่อง/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/คำขอติดตั้ง Firmware เฉพาะเครื่องที่ไม่ตรงกับ/),
    ).toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(true);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(true);
  });
});
