import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { DeviceDetailView } from "./device-detail-view";
import type { Device } from "@/lib/device-api";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const device: Device = {
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
});
