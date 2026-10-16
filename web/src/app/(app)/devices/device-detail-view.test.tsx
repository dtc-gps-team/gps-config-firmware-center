import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceDetailView } from "./device-detail-view";
import type { Device } from "@/lib/device-api";

const authState = vi.hoisted(() => ({ role: "Operation" as string }));
const rotateDeviceKey = vi.hoisted(() => vi.fn());
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { role: authState.role, accessToken: "tok" } }),
}));
vi.mock("@/lib/device-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/device-api")>()),
  rotateDeviceKey,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

let device: Device = {
  id: "id-1",
  deviceId: "DEV-0001",
  simNumber: "0800000000",
  deviceModel: "GT06N",
  protocol: "TCP",
  hardwareRevisionCode: null,
  imei: null,
  serialNumber: null,
  blackboxId: null,
  bootloader: null,
  status: "installed",
  registeredAt: "2026-01-01T00:00:00Z",
  installedAt: null,
  customer: null,
};

vi.mock("@/hooks/use-device", () => ({
  useDevice: () => ({
    data: device,
    isLoading: false,
    notFound: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const statusHook = vi.hoisted(() => ({
  value: {} as { data: unknown; isLoading: boolean; error: string | null },
}));
vi.mock("@/hooks/use-device-status", () => ({
  useDeviceStatus: () => ({ ...statusHook.value, refetch: vi.fn() }),
}));

describe("DeviceDetailView", () => {
  it("แสดงการ์ดสถานะ Config/Firmware และข้อความเก่า 'ยังไม่รองรับ' หายไปแล้ว", () => {
    statusHook.value = {
      data: {
        deviceId: "DEV-0001",
        configStatus: "up_to_date",
        firmwareStatus: "unknown",
        configRolloutId: null,
        firmwareRolloutId: null,
        lastCheckInMessage: null,
        pendingFirmwareOverride: null,
      },
      isLoading: false,
      error: null,
    };

    render(<DeviceDetailView deviceId="DEV-0001" />);

    expect(screen.getByText("สถานะ Config และ Firmware")).toBeInTheDocument();
    expect(screen.getByText("เป็นปัจจุบัน")).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่รองรับในตอนนี้/)).not.toBeInTheDocument();
  });

  it("การ์ดสถานะอยู่ก่อนข้อมูลเครื่อง (ไม่ต้องเลื่อนลงไปหา)", () => {
    statusHook.value = {
      data: {
        deviceId: "DEV-0001",
        configStatus: "up_to_date",
        firmwareStatus: "unknown",
        configRolloutId: null,
        firmwareRolloutId: null,
        lastCheckInMessage: null,
        pendingFirmwareOverride: null,
      },
      isLoading: false,
      error: null,
    };

    render(<DeviceDetailView deviceId="DEV-0001" />);

    const statusTitle = screen.getByText("สถานะ Config และ Firmware");
    const simLabel = screen.getByText("SIM Number");
    expect(
      statusTitle.compareDocumentPosition(simLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("โหลดสถานะไม่สำเร็จ: ข้อมูลหลักของอุปกรณ์ยังแสดงครบ มี error เฉพาะในการ์ดสถานะ", () => {
    statusHook.value = {
      data: null,
      isLoading: false,
      error: "โหลดสถานะอุปกรณ์ไม่สำเร็จ",
    };

    render(<DeviceDetailView deviceId="DEV-0001" />);

    expect(screen.getByText("DEV-0001")).toBeInTheDocument();
    expect(screen.getByText("GT06N")).toBeInTheDocument();
    expect(screen.getByText("โหลดสถานะอุปกรณ์ไม่สำเร็จ")).toBeInTheDocument();
  });

  it("เครื่องเก่าที่ไม่มี IMEI/Serial/Blackbox ID: แสดง ยังไม่ได้บันทึก ไม่ใช่ ไม่ระบุ", () => {
    statusHook.value = { data: null, isLoading: false, error: null };

    render(<DeviceDetailView deviceId="DEV-0001" />);

    expect(screen.getAllByText("ยังไม่ได้บันทึก")).toHaveLength(3);
  });

  it("มีรหัสรุ่นย่อย: แสดงรหัสเป็นป้ายข้างสถานะ", () => {
    statusHook.value = { data: null, isLoading: false, error: null };
    device = { ...device, hardwareRevisionCode: "RevA" };

    render(<DeviceDetailView deviceId="DEV-0001" />);

    expect(screen.getAllByText("RevA").length).toBeGreaterThan(0);
    device = { ...device, hardwareRevisionCode: null };
  });

  it("Operation ไม่เห็นปุ่มออก API Key ใหม่", () => {
    statusHook.value = { data: null, isLoading: false, error: null };
    authState.role = "Operation";

    render(<DeviceDetailView deviceId="DEV-0001" />);

    expect(
      screen.queryByRole("button", { name: /ออก API Key ใหม่/ }),
    ).not.toBeInTheDocument();
  });

  it("Admin: ต้องยืนยันก่อน แล้วโชว์ key ใหม่", async () => {
    statusHook.value = { data: null, isLoading: false, error: null };
    authState.role = "Admin";
    rotateDeviceKey.mockResolvedValue({ deviceId: "DEV-0001", apiKey: "new-key-123" });
    const user = userEvent.setup();

    render(<DeviceDetailView deviceId="DEV-0001" />);
    await user.click(screen.getByRole("button", { name: /ออก API Key ใหม่/ }));
    expect(rotateDeviceKey).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ยืนยันออก key ใหม่" }));

    expect(rotateDeviceKey).toHaveBeenCalledWith("tok", "DEV-0001");
    expect(await screen.findByDisplayValue("new-key-123")).toBeInTheDocument();
  });
});
