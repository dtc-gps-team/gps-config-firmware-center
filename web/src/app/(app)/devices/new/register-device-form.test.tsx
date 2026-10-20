import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RegisterDeviceForm } from "./register-device-form";

const registerDevice = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { role: "Admin", accessToken: "tok" } }),
}));
vi.mock("@/lib/device-api", () => ({ registerDevice }));
vi.mock("@/hooks/use-customers", () => ({
  useCustomers: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-device-models", () => ({
  useDeviceModels: () => ({
    data: [
      {
        id: "m1",
        name: "GT06N",
        status: "active",
        supportedProtocols: ["TCP"],
      },
    ],
  }),
}));
const central = vi.hoisted(() => ({
  value: { reachable: true, devices: [] } as {
    reachable: boolean;
    devices: unknown[];
  } | null,
}));
vi.mock("@/hooks/use-central-devices", () => ({
  useCentralDevices: () => ({ data: central.value }),
}));
vi.mock("@/hooks/use-devices", () => ({
  useDevices: () => ({ data: [{ deviceId: "DEV-TAKEN" }] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("RegisterDeviceForm: IMEI / Serial Number / Blackbox ID บังคับกรอก", () => {
  beforeEach(() => {
    registerDevice.mockReset();
    central.value = { reachable: true, devices: [] };
  });

  async function fillBase(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Device ID"), "DEV-1");
    await user.type(screen.getByLabelText("SIM Number"), "0899999999");
    await user.click(screen.getByLabelText("โมเดล"));
    await user.click(await screen.findByRole("option", { name: "GT06N" }));
  }

  it("ใช้คำว่า โมเดล และโปรโตคอลถูกเลือกให้เองและล็อกช่อง (1 โมเดลมีได้โปรโตคอลเดียว)", async () => {
    const user = userEvent.setup();
    render(<RegisterDeviceForm />);

    await fillBase(user);

    expect(screen.getByLabelText("โปรโตคอล")).toHaveTextContent("TCP");
    // 1 โมเดลมีได้โปรโตคอลเดียว: ช่องถูกล็อก เปลี่ยนไม่ได้
    expect(screen.getByLabelText("โปรโตคอล")).toBeDisabled();
  });

  it("ยังไม่กรอกทั้งสามช่อง: ปุ่มลงทะเบียนกดไม่ได้ ไม่ยิง API", async () => {
    const user = userEvent.setup();
    render(<RegisterDeviceForm />);
    await fillBase(user);

    expect(
      screen.getByRole("button", { name: "ลงทะเบียนอุปกรณ์" }),
    ).toBeDisabled();
    expect(registerDevice).not.toHaveBeenCalled();
  });

  it("กรอกครบแล้วส่งค่าที่ตัดช่องว่างหัวท้ายให้ API", async () => {
    registerDevice.mockResolvedValue({ deviceId: "DEV-1", apiKey: "k" });
    const user = userEvent.setup();
    render(<RegisterDeviceForm />);
    await fillBase(user);
    await user.type(screen.getByLabelText("IMEI"), " 860000000000001 ");
    await user.type(screen.getByLabelText("Serial Number"), "SN-1");
    await user.type(screen.getByLabelText("Blackbox ID"), "BB-1");

    await user.click(screen.getByRole("button", { name: "ลงทะเบียนอุปกรณ์" }));

    expect(registerDevice).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({
        imei: "860000000000001",
        serialNumber: "SN-1",
        blackboxId: "BB-1",
      }),
    );
  });

  describe("เลือกจาก Server กลาง", () => {
    const box = (deviceId: string, online = true) => ({
      deviceId,
      hardwareModel: "gt06n",
      online,
    });

    it("เติม Device ID โมเดล และค่าชั่วคราว central: ให้ แล้วแก้ทับได้", async () => {
      central.value = { reachable: true, devices: [box("BOX-0001")] };
      const user = userEvent.setup();
      render(<RegisterDeviceForm />);

      await user.click(screen.getByLabelText(/เลือกจาก Server กลาง/));
      await user.click(
        await screen.findByRole("option", { name: "BOX-0001 (ออนไลน์)" }),
      );

      expect(screen.getByLabelText("Device ID")).toHaveValue("BOX-0001");
      expect(screen.getByLabelText("IMEI")).toHaveValue("central:BOX-0001");
      expect(screen.getByLabelText("Serial Number")).toHaveValue(
        "central:BOX-0001",
      );
      // จับคู่โมเดลจาก hardware_model ไม่สนตัวพิมพ์ และเลือกโปรโตคอลให้เอง
      expect(screen.getByLabelText("โมเดล")).toHaveTextContent("GT06N");
      expect(screen.getByLabelText("โปรโตคอล")).toHaveTextContent("TCP");

      await user.clear(screen.getByLabelText("IMEI"));
      await user.type(screen.getByLabelText("IMEI"), "860000000000001");
      expect(screen.getByLabelText("IMEI")).toHaveValue("860000000000001");
    });

    it("ไม่เสนอกล่องที่ลงทะเบียนในระบบเราไปแล้ว", async () => {
      central.value = {
        reachable: true,
        devices: [box("DEV-TAKEN"), box("BOX-0002", false)],
      };
      const user = userEvent.setup();
      render(<RegisterDeviceForm />);

      await user.click(screen.getByLabelText(/เลือกจาก Server กลาง/));

      expect(
        await screen.findByRole("option", { name: "BOX-0002 (ออฟไลน์)" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /DEV-TAKEN/ }),
      ).not.toBeInTheDocument();
    });

    it("ติดต่อ Server กลางไม่ได้: บอกให้กรอกเอง ฟอร์มยังใช้ได้", () => {
      central.value = { reachable: false, devices: [] };
      render(<RegisterDeviceForm />);

      expect(
        screen.getByText(/ติดต่อ Server กลางไม่ได้ตอนนี้/),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Device ID")).toBeEnabled();
    });

    it("ยังโหลดไม่เสร็จ (ไม่มีข้อมูล): ไม่แสดงส่วนนี้", () => {
      central.value = null;
      render(<RegisterDeviceForm />);

      expect(
        screen.queryByLabelText(/เลือกจาก Server กลาง/),
      ).not.toBeInTheDocument();
    });
  });
});
