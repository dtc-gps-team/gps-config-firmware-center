import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceCentralCard } from "./device-central-card";
import type {
  CentralDevice,
  DeviceCentralView,
} from "@/lib/central-device-api";

const hookState = vi.hoisted(() => ({
  value: {} as {
    data: unknown;
    isLoading: boolean;
    error: string | null;
    refetch: () => void;
  },
}));
vi.mock("@/hooks/use-central-devices", () => ({
  useDeviceCentral: () => hookState.value,
}));

function device(overrides: Partial<CentralDevice> = {}): CentralDevice {
  return {
    deviceId: "BOX-0001",
    hardwareModel: "ESP32-DEVKIT-V1",
    online: true,
    lastSeenAt: new Date().toISOString(),
    reportedFirmwareVersion: "1.2.0",
    reportedConfigVersion: 8,
    reportedSchemaVersion: 1,
    desiredConfigVersion: 8,
    registered: true,
    lastCommand: null,
    ...overrides,
  };
}

function view(overrides: Partial<DeviceCentralView> = {}): DeviceCentralView {
  return {
    mode: "real",
    reachable: true,
    error: null,
    fetchedAt: new Date().toISOString(),
    device: device(),
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

describe("DeviceCentralCard", () => {
  beforeEach(() => setHook({}));

  it("กำลังโหลดครั้งแรก: แสดงโครงรอ", () => {
    setHook({ isLoading: true });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(
      screen.getByLabelText("กำลังโหลดสถานะจาก Server กลาง"),
    ).toBeInTheDocument();
  });

  it("แสดงออนไลน์ เวอร์ชันที่กล่องรายงาน และคำสั่งล่าสุดพร้อมสถานะ", () => {
    setHook({
      data: view({
        device: device({
          lastCommand: {
            commandId: "CMD-1",
            action: "UPDATE_CONFIG",
            target: "8",
            status: "SUCCESS",
            errorCode: null,
            updatedAt: null,
          },
        }),
      }),
    });
    render(<DeviceCentralCard deviceId="BOX-0001" />);

    expect(screen.getByText("ออนไลน์")).toBeInTheDocument();
    expect(screen.getByText("1.2.0")).toBeInTheDocument();
    expect(screen.getByText("v8")).toBeInTheDocument();
    expect(screen.getByText(/อัปเดต Config ถึงเวอร์ชัน 8/)).toBeInTheDocument();
    expect(screen.getByText("สำเร็จ")).toBeInTheDocument();
    expect(screen.queryByText("ข้อมูลตัวอย่าง")).not.toBeInTheDocument();
  });

  it("โหมด mock: มีป้ายข้อมูลตัวอย่าง", () => {
    setHook({ data: view({ mode: "mock" }) });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(screen.getByText("ข้อมูลตัวอย่าง")).toBeInTheDocument();
  });

  it("Config ที่กล่องรายงานยังไม่ถึงเป้าหมาย: แสดงเวอร์ชันเป้าหมาย", () => {
    setHook({
      data: view({
        device: device({ reportedConfigVersion: 7, desiredConfigVersion: 8 }),
      }),
    });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getByText("เป้าหมาย v8")).toBeInTheDocument();
  });

  it("คำสั่งล้มเหลว: แสดงสถานะและรหัสข้อผิดพลาด", () => {
    setHook({
      data: view({
        device: device({
          lastCommand: {
            commandId: "CMD-2",
            action: "UPDATE_FIRMWARE",
            target: "1.3.0",
            status: "FAILED",
            errorCode: "DEVICE_NO_RESPONSE",
            updatedAt: null,
          },
        }),
      }),
    });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(screen.getByText("ล้มเหลว")).toBeInTheDocument();
    expect(screen.getByText("DEVICE_NO_RESPONSE")).toBeInTheDocument();
  });

  it("ออฟไลน์และไม่เคยเชื่อมต่อ", () => {
    setHook({
      data: view({
        device: device({
          online: false,
          lastSeenAt: null,
          reportedFirmwareVersion: null,
          reportedConfigVersion: null,
        }),
      }),
    });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(screen.getByText("ออฟไลน์")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่เคยเชื่อมต่อ")).toBeInTheDocument();
    expect(screen.getAllByText("ยังไม่รายงาน")).toHaveLength(2);
  });

  it("ติดต่อ Server กลางไม่ได้: แจ้งในการ์ดว่าข้อมูลอื่นยังใช้ได้", () => {
    setHook({
      data: view({
        reachable: false,
        error: "Server กลางไม่ตอบภายใน 5000 มิลลิวินาที",
        device: null,
      }),
    });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(
      screen.getByText("ติดต่อ Server กลางไม่ได้ตอนนี้"),
    ).toBeInTheDocument();
    expect(screen.getByText(/ไม่ตอบภายใน 5000/)).toBeInTheDocument();
  });

  it("Server กลางไม่รู้จักเครื่องนี้: อธิบายว่าจะปรากฏเมื่อกล่องเชื่อมต่อ", () => {
    setHook({ data: view({ device: null }) });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(screen.getByText(/ยังไม่รู้จักเครื่องนี้/)).toBeInTheDocument();
  });

  it("กล่องยังไม่อยู่ในทะเบียน delivery: เตือนว่าสั่ง Config ไม่ได้", () => {
    setHook({ data: view({ device: device({ registered: false }) }) });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(screen.getByText(/ยังสั่ง Config ไม่ได้/)).toBeInTheDocument();
  });

  it("โหลดไม่สำเร็จและยังไม่มีข้อมูล: มีปุ่มลองใหม่", async () => {
    const refetch = vi.fn();
    setHook({ error: "เครือข่ายขัดข้อง", refetch });
    const user = userEvent.setup();
    render(<DeviceCentralCard deviceId="BOX-0001" />);

    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("รีเฟรชเบื้องหลังล้มเหลวแต่มีข้อมูลเดิม: ยังแสดงข้อมูลเดิมพร้อมหมายเหตุ", () => {
    setHook({ data: view(), error: "หมดเวลา" });
    render(<DeviceCentralCard deviceId="BOX-0001" />);
    expect(screen.getByText("ออนไลน์")).toBeInTheDocument();
    expect(screen.getByText(/รีเฟรชล่าสุดไม่สำเร็จ/)).toBeInTheDocument();
  });
});
