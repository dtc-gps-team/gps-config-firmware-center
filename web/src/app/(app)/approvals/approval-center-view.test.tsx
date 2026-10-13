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

    // เช็คจากชื่อ section ไม่ใช่ CardDescription — คิวว่างทุกคิวในเทสนี้ section
    // เลยยุบเหลือแถบบรรทัดเดียว (ข้อ 14) ซึ่งมีแค่ชื่อ ไม่มีคำอธิบาย
    expect(
      screen.queryByText(/^Config Override รออนุมัติ/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^Firmware Override รออนุมัติ/),
    ).not.toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(false);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(false);

    // section ที่ role ใดก็อ่านได้อยู่แล้ว (Config/Campaign Rollout) ยังต้องเห็นตามปกติ
    expect(screen.getByText(/^Config รออนุมัติ/)).toBeInTheDocument();
    expect(screen.getByText(/^Campaign Rollout รออนุมัติ/)).toBeInTheDocument();
  });

  it("role Operation: เห็นครบทั้ง 4 section เหมือนเดิม และ hook ถูกเรียกด้วย enabled=true", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(screen.getByText(/^Config Override รออนุมัติ/)).toBeInTheDocument();
    expect(
      screen.getByText(/^Firmware Override รออนุมัติ/),
    ).toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(true);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(true);
  });
});

/** รายการแก้ UI เว็บข้อ 14 — section ที่คิวว่างยุบเหลือแถบบรรทัดเดียว */
describe("ApprovalCenterView — ยุบ section ที่คิวว่าง", () => {
  it("คิวว่างทั้งหมด: ทุก section เป็นแถบบรรทัดเดียว ไม่มีคำอธิบาย/EmptyState เต็ม", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(screen.getAllByText(/ไม่มีรายการรออนุมัติ/)).toHaveLength(4);
    expect(
      screen.queryByText(/Config ที่ทดสอบผ่านแล้ว/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/คำขอแก้ค่าพารามิเตอร์เฉพาะเครื่อง/),
    ).not.toBeInTheDocument();
  });

  it("คิวโหลดพัง: ไม่ยุบ ยังโชว์การ์ดเต็มพร้อม error + ปุ่มลองใหม่", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue({
      data: null,
      isLoading: false,
      error: "โหลดไม่สำเร็จ",
      refetch: vi.fn(),
    });
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(
      screen.getByText(/คำขอแก้ค่าพารามิเตอร์เฉพาะเครื่อง/),
    ).toBeInTheDocument();
    expect(screen.getByText("โหลดไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
    // อีก 3 section ที่คิวว่างจริงยังยุบตามปกติ
    expect(screen.getAllByText(/ไม่มีรายการรออนุมัติ/)).toHaveLength(3);
  });
});

describe("ApprovalCenterView — ข้อความหัวหน้าและหัวข้อ", () => {
  it("คำอธิบายหัวหน้าบอกว่ารวมคำขอทุกประเภท และไม่มีจุดคั่นกลาง", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    const { container } = render(<ApprovalCenterView />);

    expect(
      screen.getByText(/คำขอทุกประเภทที่รอ Operation อนุมัติ/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("·");
    // ชื่อเดิม "Per-device Config Override" เปลี่ยนให้ตรงกับป้ายบนการ์ด
    expect(screen.queryByText(/Per-device/)).not.toBeInTheDocument();
  });
});
