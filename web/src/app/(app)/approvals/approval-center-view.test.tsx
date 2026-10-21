import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
  it("role Admin: ไม่เห็นแท็บ Config Override / Firmware Override เลย และ hook ถูกเรียกด้วย enabled=false", () => {
    authState.role = "Admin";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(
      screen.queryByRole("button", { name: /^Config Override/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Firmware Override/ }),
    ).not.toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(false);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(false);

    // หมวดที่ role ใดก็อ่านได้อยู่แล้ว (Config/Campaign Rollout) ยังต้องเห็นเป็นแท็บ
    expect(screen.getByRole("button", { name: /^Config\s*\d*$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Campaign Rollout/ }),
    ).toBeInTheDocument();
  });

  it("role Operation: เห็นครบทั้ง 4 แท็บ และ hook ถูกเรียกด้วย enabled=true", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(
      screen.getByRole("button", { name: /^Config Override/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Firmware Override/ }),
    ).toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(true);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(true);
  });
});

/** รายการแก้ UI เว็บตามรีวิวพี่เลี้ยง: แยกหมวดเป็นแท็บ แสดงทีละหมวด */
describe("ApprovalCenterView — แท็บแยกหมวดคำขอ", () => {
  it("เปิดมาที่หมวด Config และกดสลับไปหมวดอื่นได้ โดยแต่ละครั้งเห็นแค่หมวดเดียว", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(screen.getByText(/^Config รออนุมัติ/)).toBeInTheDocument();
    expect(
      screen.queryByText(/^Campaign Rollout รออนุมัติ/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Campaign Rollout/ }));
    expect(screen.getByText(/^Campaign Rollout รออนุมัติ/)).toBeInTheDocument();
    expect(screen.queryByText(/^Config รออนุมัติ/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Config Override/ }));
    expect(screen.getByText(/^Config Override รออนุมัติ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Firmware Override/ }));
    expect(
      screen.getByText(/^Firmware Override รออนุมัติ/),
    ).toBeInTheDocument();
  });

  it("แท็บที่เลือกอยู่มี aria-pressed=true แท็บอื่นเป็น false", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    const configTab = screen.getByRole("button", { name: /^Config\s*\d*$/ });
    const rolloutTab = screen.getByRole("button", { name: /^Campaign Rollout/ });
    expect(configTab).toHaveAttribute("aria-pressed", "true");
    expect(rolloutTab).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(rolloutTab);
    expect(configTab).toHaveAttribute("aria-pressed", "false");
    expect(rolloutTab).toHaveAttribute("aria-pressed", "true");
  });

  it("ป้ายตัวเลขบนแท็บแสดงจำนวนรออนุมัติของแต่ละหมวด", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue({
      ...emptyQueryState(),
      data: [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
    });
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(
      screen.getByRole("button", { name: /^Config Override\s*3$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Firmware Override\s*0$/ }),
    ).toBeInTheDocument();
  });

  it("หมวดที่โหลดพัง: เห็น error + ปุ่มลองใหม่ เมื่อกดเข้าหมวดนั้น", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue({
      data: null,
      isLoading: false,
      error: "โหลดไม่สำเร็จ",
      refetch: vi.fn(),
    });
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    fireEvent.click(screen.getByRole("button", { name: /^Config Override/ }));
    expect(
      screen.getByText(/คำขอแก้ค่าพารามิเตอร์เฉพาะเครื่อง/),
    ).toBeInTheDocument();
    expect(screen.getByText("โหลดไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
  });

  it("หมวดที่ว่าง: แสดงข้อความว่าไม่มีรายการ ไม่ซ่อนทั้งหมวด", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(screen.getByText("ไม่มี Config รออนุมัติ")).toBeInTheDocument();
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
