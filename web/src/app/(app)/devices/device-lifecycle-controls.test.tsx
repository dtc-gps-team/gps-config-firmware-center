import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DecommissionControl,
  DecommissionedNotice,
  EditDeviceControl,
  ReactivateControl,
} from "./device-lifecycle-controls";
import type { Device } from "@/lib/device-api";

const authState = vi.hoisted(() => ({ role: "Admin" as string | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: authState.role } }),
}));

const updateDevice = vi.fn();
const decommissionDevice = vi.fn();
const reactivateDevice = vi.fn();
vi.mock("@/lib/device-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/device-api")>(
      "@/lib/device-api",
    );
  return {
    ...actual,
    updateDevice: (...args: unknown[]) => updateDevice(...args),
    decommissionDevice: (...args: unknown[]) => decommissionDevice(...args),
    reactivateDevice: (...args: unknown[]) => reactivateDevice(...args),
  };
});
vi.mock("@/hooks/use-customers", () => ({
  useCustomers: () => ({
    data: [
      { id: "c1", companyName: "Acme", isActive: true },
      { id: "c2", companyName: "Zeta", isActive: true },
    ],
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const installed: Device = {
  id: "d1",
  deviceId: "DEV-1",
  simNumber: "0811111111",
  modelId: "model-gt06n",
  deviceModel: "GT06N",
  protocol: "TCP",
  hardwareRevisionCode: "RevA",
  imei: "860000000000001",
  serialNumber: "SN-1",
  blackboxId: "BB-1",
  status: "installed",
  registeredAt: "2026-01-01T00:00:00Z",
  installedAt: "2026-01-02T00:00:00Z",
  decommissionedAt: null,
  decommissionReason: null,
  customer: { id: "c1", companyName: "Acme" },
};
const decommissioned: Device = {
  ...installed,
  status: "decommissioned",
  decommissionedAt: "2026-03-01T00:00:00Z",
  decommissionReason: "รถถูกขายแล้ว",
};

beforeEach(() => {
  authState.role = "Admin";
  updateDevice.mockReset();
  decommissionDevice.mockReset();
  reactivateDevice.mockReset();
});

describe("EditDeviceControl", () => {
  it("ส่งเฉพาะ field ที่เปลี่ยน และปุ่มบันทึกกดไม่ได้จนกว่าจะมีอะไรเปลี่ยน", async () => {
    updateDevice.mockResolvedValue({ ...installed, simNumber: "0899999999" });
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditDeviceControl device={installed} onUpdated={onUpdated} />);

    await user.click(screen.getByRole("button", { name: /แก้ไขข้อมูล/ }));
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();

    const sim = screen.getByLabelText("SIM Number");
    await user.clear(sim);
    await user.type(sim, " 0899999999 ");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(updateDevice).toHaveBeenCalledTimes(1));
    expect(updateDevice).toHaveBeenCalledWith("tok", "DEV-1", {
      simNumber: "0899999999",
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("เปลี่ยนลูกค้า + ล้างรหัสรุ่นย่อย -> ส่ง customerId และ hardwareRevisionCode เป็น null", async () => {
    updateDevice.mockResolvedValue(installed);
    const user = userEvent.setup();
    render(<EditDeviceControl device={installed} onUpdated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /แก้ไขข้อมูล/ }));
    await user.clear(screen.getByLabelText(/รหัสรุ่นย่อย/));
    await user.click(screen.getByLabelText("ลูกค้า"));
    await user.click(await screen.findByRole("option", { name: "Zeta" }));
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(updateDevice).toHaveBeenCalledTimes(1));
    expect(updateDevice).toHaveBeenCalledWith("tok", "DEV-1", {
      hardwareRevisionCode: null,
      customerId: "c2",
    });
  });

  it("ล้าง IMEI ที่มีค่าอยู่ -> แจ้งว่าห้ามเว้นว่าง ไม่เรียก API · เครื่องเก่าที่ IMEI ว่างอยู่แล้วปล่อยว่างได้", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <EditDeviceControl device={installed} onUpdated={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /แก้ไขข้อมูล/ }));
    await user.clear(screen.getByLabelText("IMEI"));

    expect(screen.getByRole("alert")).toHaveTextContent("IMEI ห้ามเว้นว่าง");
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
    expect(updateDevice).not.toHaveBeenCalled();
    unmount();

    render(
      <EditDeviceControl
        device={{ ...installed, imei: null }}
        onUpdated={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /แก้ไขข้อมูล/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("IMEI ซ้ำ (409): แสดงข้อความจาก backend ในฟอร์ม ไม่ปิดกล่อง ไม่เรียก onUpdated", async () => {
    const { ApiError } = await import("@/lib/api");
    updateDevice.mockRejectedValue(
      new ApiError('IMEI "X" ซ้ำกับอุปกรณ์ DEV-2 (ปลดระวางแล้ว)', 409),
    );
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditDeviceControl device={installed} onUpdated={onUpdated} />);

    await user.click(screen.getByRole("button", { name: /แก้ไขข้อมูล/ }));
    const imei = screen.getByLabelText("IMEI");
    await user.clear(imei);
    await user.type(imei, "X");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ซ้ำกับอุปกรณ์ DEV-2");
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByLabelText("IMEI")).toBeInTheDocument();
  });

  it("ซ่อนสำหรับ Role ที่ไม่มีสิทธิ์ และสำหรับเครื่องที่ปลดระวางแล้ว", () => {
    authState.role = "Operation";
    const { unmount } = render(
      <EditDeviceControl device={installed} onUpdated={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /แก้ไขข้อมูล/ })).toBeNull();
    unmount();

    authState.role = "Admin";
    render(<EditDeviceControl device={decommissioned} onUpdated={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /แก้ไขข้อมูล/ })).toBeNull();
  });
});

describe("DecommissionControl", () => {
  it("เหตุผลบังคับ: ว่างแล้วปุ่มยืนยันกดไม่ได้ · กรอกแล้วเรียก API ด้วยเหตุผลที่ตัดช่องว่าง", async () => {
    decommissionDevice.mockResolvedValue(decommissioned);
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<DecommissionControl device={installed} onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: /^ปลดระวาง$/ }));
    const confirm = screen.getByRole("button", { name: "ยืนยันปลดระวาง" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("เหตุผล"), "  รถถูกขายแล้ว ");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(decommissionDevice).toHaveBeenCalledWith(
        "tok",
        "DEV-1",
        "รถถูกขายแล้ว",
      ),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("มีงานค้าง (409): แสดงข้อความและจำนวนจาก backend ในกล่อง ไม่ปิดกล่อง ไม่เรียก onDone", async () => {
    const { ApiError } = await import("@/lib/api");
    decommissionDevice.mockRejectedValue(
      new ApiError(
        "ปลดระวางเครื่อง DEV-1 ไม่ได้ เพราะยังมีงานค้างอยู่: งาน (Task) ที่ยังไม่จบ 1 รายการ - ทำให้จบหรือยกเลิกก่อน",
        409,
      ),
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<DecommissionControl device={installed} onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: /^ปลดระวาง$/ }));
    await user.type(screen.getByLabelText("เหตุผล"), "x");
    await user.click(screen.getByRole("button", { name: "ยืนยันปลดระวาง" }));

    expect(
      await screen.findByText(/งาน \(Task\) ที่ยังไม่จบ 1 รายการ/),
    ).toBeInTheDocument();
    expect(screen.getByText("ปลดระวาง DEV-1?")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("กล่องออนไลน์อยู่: มีคำเตือนเพิ่ม · ออฟไลน์ไม่มี", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <DecommissionControl device={installed} online onDone={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /^ปลดระวาง$/ }));
    expect(screen.getByText("กล่องนี้ออนไลน์อยู่ตอนนี้")).toBeInTheDocument();
    unmount();

    render(<DecommissionControl device={installed} onDone={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^ปลดระวาง$/ }));
    expect(screen.queryByText("กล่องนี้ออนไลน์อยู่ตอนนี้")).toBeNull();
  });

  it("ซ่อนเมื่อปลดระวางแล้ว หรือ Role ไม่มีสิทธิ์", () => {
    const { unmount } = render(
      <DecommissionControl device={decommissioned} onDone={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /^ปลดระวาง$/ })).toBeNull();
    unmount();
    authState.role = "ST";
    render(<DecommissionControl device={installed} onDone={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^ปลดระวาง$/ })).toBeNull();
  });
});

describe("ReactivateControl", () => {
  it("เปิดใช้กลับ: ไม่ใส่ SIM ส่ง body ว่าง · โชว์ API key ใหม่ครั้งเดียว · ปิดกล่อง key แล้วจึงแจ้ง onDone", async () => {
    reactivateDevice.mockResolvedValue({
      ...installed,
      status: "registered",
      apiKey: "k".repeat(64),
    });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<ReactivateControl device={decommissioned} onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: /เปิดใช้งานกลับ/ }));
    await user.click(
      screen.getByRole("button", { name: "ยืนยันเปิดใช้งานกลับ" }),
    );

    await waitFor(() =>
      expect(reactivateDevice).toHaveBeenCalledWith("tok", "DEV-1", {}),
    );
    expect(await screen.findByLabelText("API Key ใหม่")).toHaveValue(
      "k".repeat(64),
    );
    expect(onDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "ปิด" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("SIM เดิมชน (409): แสดงข้อความ ให้ใส่ SIM ใหม่ แล้วส่ง simNumber ที่ตัดช่องว่าง", async () => {
    const { ApiError } = await import("@/lib/api");
    reactivateDevice.mockRejectedValueOnce(
      new ApiError("SIM ของเครื่อง DEV-1 ถูกเครื่องอื่นที่ใช้งานอยู่ใช้ไปแล้ว", 409),
    );
    reactivateDevice.mockResolvedValueOnce({
      ...installed,
      status: "registered",
      apiKey: "a".repeat(64),
    });
    const user = userEvent.setup();
    render(<ReactivateControl device={decommissioned} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /เปิดใช้งานกลับ/ }));
    await user.click(
      screen.getByRole("button", { name: "ยืนยันเปิดใช้งานกลับ" }),
    );
    expect(
      await screen.findByText(/ถูกเครื่องอื่นที่ใช้งานอยู่ใช้ไปแล้ว/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/SIM ใหม่/), " 0822222222 ");
    await user.click(
      screen.getByRole("button", { name: "ยืนยันเปิดใช้งานกลับ" }),
    );
    await waitFor(() =>
      expect(reactivateDevice).toHaveBeenLastCalledWith("tok", "DEV-1", {
        simNumber: "0822222222",
      }),
    );
  });

  it("แสดงเฉพาะเครื่องที่ปลดระวางแล้ว", () => {
    render(<ReactivateControl device={installed} onDone={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /เปิดใช้งานกลับ/ })).toBeNull();
  });
});

describe("DecommissionedNotice", () => {
  it("แสดงเวลาและเหตุผลเมื่อปลดระวางแล้ว · ไม่แสดงเมื่อใช้งานอยู่", () => {
    const { unmount } = render(<DecommissionedNotice device={decommissioned} />);
    expect(screen.getByText(/เครื่องนี้ปลดระวางแล้ว/)).toBeInTheDocument();
    expect(screen.getByText("เหตุผล: รถถูกขายแล้ว")).toBeInTheDocument();
    unmount();

    render(<DecommissionedNotice device={installed} />);
    expect(screen.queryByText(/เครื่องนี้ปลดระวางแล้ว/)).toBeNull();
  });
});
