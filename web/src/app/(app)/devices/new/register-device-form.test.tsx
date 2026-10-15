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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("RegisterDeviceForm: IMEI / Serial Number / Blackbox ID บังคับกรอก", () => {
  beforeEach(() => registerDevice.mockReset());

  async function fillBase(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Device ID"), "DEV-1");
    await user.type(screen.getByLabelText("SIM Number"), "0899999999");
    await user.click(screen.getByLabelText("โมเดล"));
    await user.click(await screen.findByRole("option", { name: "GT06N" }));
  }

  it("ใช้คำว่า โมเดล และโปรโตคอลถูกเลือกให้เองเมื่อโมเดลรองรับอันเดียว", async () => {
    const user = userEvent.setup();
    render(<RegisterDeviceForm />);

    await fillBase(user);

    expect(screen.getByLabelText("โปรโตคอล")).toHaveTextContent("TCP");
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
});
