import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { DeviceFirmwareOverrideDetailView } from "./device-firmware-override-detail-view";
import type { DeviceFirmwareOverride } from "@/lib/device-firmware-override-api";
import type { Firmware } from "@/lib/firmware-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({ resolveName: (id: string) => `ชื่อของ ${id}` }),
}));

type Q<T> = { data: T | null; isLoading: boolean; error: string | null };
const q = <T,>(data: T | null, over: Partial<Q<T>> = {}): Q<T> => ({
  data,
  isLoading: false,
  error: null,
  ...over,
});

const state = vi.hoisted(() => ({
  override: {} as Q<unknown>,
  firmware: {} as Q<unknown>,
}));

vi.mock("@/hooks/use-device-firmware-override", () => ({
  useDeviceFirmwareOverride: () => ({ ...state.override, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-firmware", () => ({
  useFirmware: () => ({ ...state.firmware, refetch: vi.fn() }),
}));

function item(
  overrides: Partial<DeviceFirmwareOverride> = {},
): DeviceFirmwareOverride {
  return {
    id: "fov-1",
    deviceId: "DTC-0001",
    firmwareId: "fw-1",
    versionNumber: 3,
    reason: "เครื่องนี้ต้องใช้รุ่นเก่ากว่า",
    status: "pending",
    overriddenBy: "user-st-1",
    overriddenAt: "2026-01-01T00:00:00Z",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    consumedAt: null,
    ...overrides,
  };
}

describe("DeviceFirmwareOverrideDetailView", () => {
  beforeEach(() => {
    state.firmware = q<Firmware>({
      id: "fw-1",
      version: "1.0.0",
    } as Firmware);
  });

  it("กำลังโหลด -> แสดงโครงรอ ไม่พัง", () => {
    state.override = q<DeviceFirmwareOverride>(null, { isLoading: true });
    render(<DeviceFirmwareOverrideDetailView id="fov-1" />);

    expect(screen.queryByText("DTC-0001")).not.toBeInTheDocument();
  });

  it("โหลดพลาด -> แสดงข้อความ error พร้อมปุ่มลองใหม่", () => {
    state.override = q<DeviceFirmwareOverride>(null, {
      error: "โหลดไม่สำเร็จ",
    });
    render(<DeviceFirmwareOverrideDetailView id="fov-1" />);

    expect(screen.getByText("โหลดไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
  });

  it("แสดง deviceId, เหตุผล, เวอร์ชัน Firmware ที่ resolve แล้ว, ผู้ส่งคำขอ และสถานะรออนุมัติ", () => {
    state.override = q<DeviceFirmwareOverride>(item());
    render(<DeviceFirmwareOverrideDetailView id="fov-1" />);

    expect(screen.getByText("DTC-0001")).toBeInTheDocument();
    expect(screen.getByText("เครื่องนี้ต้องใช้รุ่นเก่ากว่า")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("ชื่อของ user-st-1")).toBeInTheDocument();
    expect(screen.getByText("รอการอนุมัติ")).toBeInTheDocument();
  });

  it("สถานะ approved ยังไม่ถูกใช้ -> บอกว่ารอช่างยืนยันติดตั้ง", () => {
    state.override = q<DeviceFirmwareOverride>(
      item({
        status: "approved",
        decidedBy: "user-op-1",
        decidedAt: "2026-01-02T00:00:00Z",
        consumedAt: null,
      }),
    );
    render(<DeviceFirmwareOverrideDetailView id="fov-1" />);

    expect(
      screen.getByText(/รอช่างกดยืนยันติดตั้ง Firmware เวอร์ชันนี้/),
    ).toBeInTheDocument();
    expect(screen.getByText("ชื่อของ user-op-1")).toBeInTheDocument();
  });

  it("สถานะ approved และถูกใช้ไปแล้ว -> บอกเวลาที่ใช้ ไม่มีปุ่มตัดสินใจ", () => {
    state.override = q<DeviceFirmwareOverride>(
      item({
        status: "approved",
        decidedBy: "user-op-1",
        decidedAt: "2026-01-02T00:00:00Z",
        consumedAt: "2026-01-03T00:00:00Z",
      }),
    );
    render(<DeviceFirmwareOverrideDetailView id="fov-1" />);

    expect(screen.getByText(/ใช้ไปแล้วตอน/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "อนุมัติ" }),
    ).not.toBeInTheDocument();
  });
});
