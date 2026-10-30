import { beforeEach, describe, expect, it, vi } from "vitest";
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

const usePendingFieldApplyRequests = vi.fn();
vi.mock("@/hooks/use-pending-field-apply-requests", () => ({
  usePendingFieldApplyRequests: () => usePendingFieldApplyRequests(),
}));

// แท็บเก็บอยู่ใน URL (?tab=) และ jsdom ใช้ URL ร่วมกันทั้งไฟล์ ต้องรีเซ็ตทุกเทส
beforeEach(() => {
  window.history.replaceState(null, "", "/approvals");
  usePendingFieldApplyRequests.mockReturnValue(emptyQueryState());
});

function emptyQueryState() {
  return { data: [], isLoading: false, error: null, refetch: vi.fn() };
}

function fieldApplyRequest(
  override: { id: string; reason: string; fieldNames: string[] } | null,
) {
  return {
    id: "req-1",
    taskId: "task-1",
    deviceId: "DTC-0001",
    kind: "config" as const,
    configId: "cfg-1",
    firmwareId: null,
    overrideId: override?.id ?? null,
    fromFirmwareVersion: null,
    isDowngrade: false,
    configAssignedBy: null,
    requestedBy: "user-1",
    requestedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T01:00:00Z",
    note: null,
    status: "pending" as const,
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    task: { id: "task-1", title: "ติดตั้งกล่อง" },
    config: {
      id: "cfg-1",
      name: "ชุดตั้งค่า",
      deviceModel: "ESP32",
      protocol: "HTTP",
    },
    firmware: null,
    requester: { id: "user-1", fullName: "ช่างหนึ่ง" },
    configAssigner: null,
    decider: null,
    fieldNames: ["gps.interval"],
    override,
  };
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
      screen.queryByRole("tab", { name: /^Config Override/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /^Firmware Override/ }),
    ).not.toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(false);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(false);

    // หมวดที่ role ใดก็อ่านได้อยู่แล้ว (Config/Campaign Rollout) ยังต้องเห็นเป็นแท็บ
    expect(
      screen.getByRole("tab", { name: /^Config\s*\d*$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^Campaign Rollout/ }),
    ).toBeInTheDocument();
  });

  it("role Operation: เห็นครบทั้ง 4 แท็บ และ hook ถูกเรียกด้วย enabled=true", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(
      screen.getByRole("tab", { name: /^Config Override/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^Firmware Override/ }),
    ).toBeInTheDocument();

    expect(usePendingDeviceConfigOverrides).toHaveBeenCalledWith(true);
    expect(usePendingDeviceFirmwareOverrides).toHaveBeenCalledWith(true);
  });
});

/** รายการแก้ UI เว็บตามรีวิวพี่เลี้ยง: แยกหมวดเป็นแท็บ แสดงทีละหมวด */
describe("ApprovalCenterView — แท็บแยกหมวดคำขอ", () => {
  it("เปิดแท็บแรกที่มีรายการเมื่อไม่มี tab ใน URL", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());
    usePendingFieldApplyRequests.mockReturnValue({
      ...emptyQueryState(),
      data: [fieldApplyRequest(null)],
    });

    render(<ApprovalCenterView />);

    expect(
      screen.getByRole("tab", { name: /^ส่งเข้ากล่องจากหน้างาน/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("tab=config ใน URL ยังคงเลือก Config แม้แท็บอื่นมีรายการ", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());
    usePendingFieldApplyRequests.mockReturnValue({
      ...emptyQueryState(),
      data: [fieldApplyRequest(null)],
    });
    window.history.replaceState(null, "", "/approvals?tab=config");

    render(<ApprovalCenterView />);

    expect(screen.getByRole("tab", { name: /^Config\s*0$/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("แจ้งจำนวนคำขอที่มี override และปุ่มพาไปแท็บหน้างานได้", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());
    usePendingFieldApplyRequests.mockReturnValue({
      ...emptyQueryState(),
      data: [
        fieldApplyRequest({
          id: "ov-1",
          reason: "ปรับค่า",
          fieldNames: ["gps.interval"],
        }),
      ],
    });

    render(<ApprovalCenterView />);
    fireEvent.click(screen.getByRole("tab", { name: /^Config Override/ }));

    expect(
      screen.getByText(/มีคำขอแก้ค่าจากหน้างาน 1 รายการ/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ไปที่คำขอ" }));
    expect(
      screen.getByRole("tab", { name: /^ส่งเข้ากล่องจากหน้างาน/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("ไม่แสดง notice เมื่อไม่มีคำขอที่มี override", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());
    usePendingFieldApplyRequests.mockReturnValue({
      ...emptyQueryState(),
      data: [fieldApplyRequest(null)],
    });

    render(<ApprovalCenterView />);
    fireEvent.click(screen.getByRole("tab", { name: /^Config Override/ }));

    expect(
      screen.queryByText(/มีคำขอแก้ค่าจากหน้างาน/),
    ).not.toBeInTheDocument();
  });

  it("เปิดมาที่หมวด Config และกดสลับไปหมวดอื่นได้ โดยแต่ละครั้งเห็นแค่หมวดเดียว", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    expect(screen.getByText(/^Config รออนุมัติ/)).toBeInTheDocument();
    expect(
      screen.queryByText(/^Campaign Rollout รออนุมัติ/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^Campaign Rollout/ }));
    expect(screen.getByText(/^Campaign Rollout รออนุมัติ/)).toBeInTheDocument();
    expect(screen.queryByText(/^Config รออนุมัติ/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^Config Override/ }));
    expect(screen.getByText(/^Config Override รออนุมัติ/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^Firmware Override/ }));
    expect(
      screen.getByText(/^Firmware Override รออนุมัติ/),
    ).toBeInTheDocument();
  });

  it("แท็บที่เลือกอยู่มี aria-selected=true แท็บอื่นเป็น false", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());

    render(<ApprovalCenterView />);

    const configTab = screen.getByRole("tab", { name: /^Config\s*\d*$/ });
    const rolloutTab = screen.getByRole("tab", { name: /^Campaign Rollout/ });
    expect(configTab).toHaveAttribute("aria-selected", "true");
    expect(rolloutTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(rolloutTab);
    expect(configTab).toHaveAttribute("aria-selected", "false");
    expect(rolloutTab).toHaveAttribute("aria-selected", "true");
  });

  it("ป้ายตัวเลขบนแท็บแสดงจำนวนรออนุมัติของแต่ละหมวด", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue({
      ...emptyQueryState(),
      data: [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
    });
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());
    window.history.replaceState(null, "", "/approvals?tab=config");

    render(<ApprovalCenterView />);

    expect(
      screen.getByRole("tab", { name: /^Config Override\s*3$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^Firmware Override\s*0$/ }),
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

    fireEvent.click(screen.getByRole("tab", { name: /^Config Override/ }));
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

describe("ApprovalCenterView: มุมมองย่อยอยู่ใน URL", () => {
  it("เปิดจากลิงก์ ?view=mine แล้วเลือกมุมมอง 'เจาะจงถึงฉัน' ให้เลย", () => {
    authState.role = "Operation";
    usePendingDeviceConfigOverrides.mockReturnValue(emptyQueryState());
    usePendingDeviceFirmwareOverrides.mockReturnValue(emptyQueryState());
    window.history.replaceState(null, "", "/approvals?view=mine");

    render(<ApprovalCenterView />);
    expect(
      screen.getByText("ไม่มี Config ที่เจาะจงถึงคุณ"),
    ).toBeInTheDocument();
  });
});
