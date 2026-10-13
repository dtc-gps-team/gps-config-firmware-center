import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceStatusCard } from "./device-status-card";
import type { DeviceStatusInfo } from "@/lib/device-api";

const hookState = vi.hoisted(() => ({
  value: {} as {
    data: unknown;
    isLoading: boolean;
    error: string | null;
    refetch: () => void;
  },
}));
vi.mock("@/hooks/use-device-status", () => ({
  useDeviceStatus: () => hookState.value,
}));

function status(overrides: Partial<DeviceStatusInfo> = {}): DeviceStatusInfo {
  return {
    deviceId: "DEV-0001",
    configStatus: "unknown",
    firmwareStatus: "unknown",
    configRolloutId: null,
    firmwareRolloutId: null,
    lastCheckInMessage: null,
    pendingFirmwareOverride: null,
    ...overrides,
  };
}

function setHook(partial: Partial<typeof hookState.value>) {
  hookState.value = {
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...partial,
  };
}

/**
 * ช่องว่างที่ B ชี้ใน #282: หน้ารายละเอียดอุปกรณ์บนเว็บเคยมีแค่ข้อความ
 * "ยังไม่รองรับ" ทั้งที่ backend มี `GET /devices/{id}/status` และมือถือใช้อยู่
 */
describe("DeviceStatusCard", () => {
  beforeEach(() => setHook({}));

  it("กำลังโหลดครั้งแรก: แสดงโครงรอ ไม่แสดงสถานะ", () => {
    setHook({ isLoading: true });

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    expect(screen.getByLabelText("กำลังโหลดสถานะ")).toBeInTheDocument();
    expect(screen.queryByText("Config")).not.toBeInTheDocument();
  });

  it("แสดงสถานะของ Config และ Firmware แยกกัน คำอธิบายเฉพาะสถานะที่ต้องตามต่อ", () => {
    setHook({
      data: status({ configStatus: "up_to_date", firmwareStatus: "failed" }),
    });

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    expect(screen.getByText("เป็นปัจจุบัน")).toBeInTheDocument();
    // สถานะปกติ: มีแค่ป้าย ไม่มีคำอธิบายให้รก
    expect(
      screen.queryByText("Rollout Config ล่าสุดของเครื่องนี้สำเร็จแล้ว"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("ล้มเหลว")).toBeInTheDocument();
    expect(
      screen.getByText("Rollout Firmware ล่าสุดของเครื่องนี้ไม่สำเร็จ"),
    ).toBeInTheDocument();
  });

  it("สถานะ pending: ป้ายแยกตามชนิด (Config รอรับ, Firmware รอติดตั้ง)", () => {
    setHook({
      data: status({ configStatus: "pending", firmwareStatus: "pending" }),
    });

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    expect(screen.getByText("รอรับ Config")).toBeInTheDocument();
    expect(screen.getByText("รอติดตั้ง Firmware")).toBeInTheDocument();
  });

  it("เครื่องที่ไม่เคยอยู่ใน Rollout (unknown) ไม่ถูกแสดงเป็นความผิดปกติ", () => {
    setHook({ data: status() });

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    expect(screen.getAllByText("ยังไม่เคยอยู่ใน Rollout")).toHaveLength(2);
    expect(screen.queryByText("ล้มเหลว")).not.toBeInTheDocument();
  });

  it("ไอคอน ⓘ ข้างหัวการ์ด: ชี้แล้วบอกว่าสถานะคำนวณจากผล Rollout ไม่ได้อ่านจากกล่องจริง", async () => {
    setHook({ data: status() });
    const user = userEvent.setup();

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    await user.hover(screen.getByRole("button", { name: "ที่มาของสถานะ" }));
    // ข้อความต่อกันไม่มีช่องว่างเกินก่อน "โดยตรง" (บั๊กเดิมจาก JSX ขึ้นบรรทัดใหม่)
    expect(
      await screen.findByText(
        "สถานะคำนวณจากผล Rollout ล่าสุดของเครื่องนี้ ไม่ได้อ่านค่าจากกล่องจริงโดยตรง",
      ),
    ).toBeInTheDocument();
  });

  it("มีคำขอ Firmware Override รออนุมัติ: แสดงแจ้งเตือนพร้อมเวลาที่ส่ง", () => {
    setHook({
      data: status({
        pendingFirmwareOverride: {
          id: "o1",
          deviceId: "DEV-0001",
          firmwareId: "f1",
          versionNumber: 1,
          reason: "ต้องการ 2.5.0",
          status: "pending",
          overriddenBy: "u1",
          overriddenAt: "2026-10-12T08:00:00.000Z",
          decidedBy: null,
          decidedAt: null,
          rejectReason: null,
          consumedAt: null,
        },
      }),
    });

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    expect(
      screen.getByText(/มีคำขอ Firmware Override รออนุมัติ/),
    ).toBeInTheDocument();
  });

  it("ไม่มีคำขอ Override ที่ค้าง: ไม่แสดงแจ้งเตือน", () => {
    setHook({ data: status() });

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    expect(
      screen.queryByText(/มีคำขอ Firmware Override รออนุมัติ/),
    ).not.toBeInTheDocument();
  });

  it("โหลดไม่สำเร็จ: แสดงข้อความ error และปุ่มลองใหม่ที่เรียก refetch", async () => {
    const refetch = vi.fn();
    setHook({ error: "โหลดสถานะอุปกรณ์ไม่สำเร็จ", refetch });
    const user = userEvent.setup();

    render(<DeviceStatusCard deviceId="DEV-0001" />);

    expect(screen.getByText("โหลดสถานะอุปกรณ์ไม่สำเร็จ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
