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
  value: { mode: "real", reachable: true, devices: [] } as {
    mode: "mock" | "real";
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
    central.value = { mode: "real", reachable: true, devices: [] };
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

    it("เติมเฉพาะ Device ID กับโมเดล (ค่าจริง) ส่วน SIM/IMEI/Serial/Blackbox ปล่อยว่างให้กรอกเอง", async () => {
      central.value = {
        mode: "real",
        reachable: true,
        devices: [box("BOX-0001")],
      };
      const user = userEvent.setup();
      render(<RegisterDeviceForm />);

      await user.click(screen.getByLabelText(/เลือกจาก Server กลาง/));
      await user.click(
        await screen.findByRole("option", { name: "BOX-0001 (ออนไลน์)" }),
      );

      expect(screen.getByLabelText("Device ID")).toHaveValue("BOX-0001");
      // จับคู่โมเดลจาก hardware_model ไม่สนตัวพิมพ์ และเลือกโปรโตคอลให้เอง
      expect(screen.getByLabelText("โมเดล")).toHaveTextContent("GT06N");
      expect(screen.getByLabelText("โปรโตคอล")).toHaveTextContent("TCP");
      // ไม่มีค่าชั่วคราวใดๆ: ระบบแก้ข้อมูลเครื่องทีหลังไม่ได้ ค่าที่ลืมแก้จะค้างถาวร
      for (const label of [
        "SIM Number",
        "IMEI",
        "Serial Number",
        "Blackbox ID",
      ]) {
        expect(screen.getByLabelText(label)).toHaveValue("");
      }
      // ยังไม่กรอกครบ ปุ่มลงทะเบียนกดไม่ได้
      expect(
        screen.getByRole("button", { name: "ลงทะเบียนอุปกรณ์" }),
      ).toBeDisabled();
    });

    it("ช่องที่ขึ้นต้นด้วย central: (วางหรือพิมพ์เอง) กดส่งไม่ได้ ไม่เรียก API และบอกว่าช่องไหน", // พิมพ์หลายช่อง + คลิกเลือกตัวเลือกหลายครั้ง (userEvent จำลองทีละตัวอักษร) ช้ากว่าปกติภายใต้
    // โหลดตอนรันทั้งชุดพร้อมกัน จึงให้เวลามากกว่าค่าเริ่มต้น 5 วินาที
    async () => {
      central.value = {
        mode: "real",
        reachable: true,
        devices: [box("BOX-0001")],
      };
      const user = userEvent.setup();
      render(<RegisterDeviceForm />);
      await user.click(screen.getByLabelText(/เลือกจาก Server กลาง/));
      await user.click(
        await screen.findByRole("option", { name: "BOX-0001 (ออนไลน์)" }),
      );
      await user.type(screen.getByLabelText("SIM Number"), "0899999999");
      await user.type(screen.getByLabelText("IMEI"), "Central:BOX-0001");
      await user.type(screen.getByLabelText("Serial Number"), "SN-1");
      await user.type(screen.getByLabelText("Blackbox ID"), "BB-1");

      await user.click(
        screen.getByRole("button", { name: "ลงทะเบียนอุปกรณ์" }),
      );

      expect(registerDevice).not.toHaveBeenCalled();
      expect(
        screen.getByText(/ช่อง IMEI ยังเป็นค่าชั่วคราว/),
      ).toBeInTheDocument();

      // แก้เป็นค่าจริงแล้วส่งได้
      registerDevice.mockResolvedValue({ deviceId: "BOX-0001", apiKey: "k" });
      await user.clear(screen.getByLabelText("IMEI"));
      await user.type(screen.getByLabelText("IMEI"), "860000000000001");
      await user.click(
        screen.getByRole("button", { name: "ลงทะเบียนอุปกรณ์" }),
      );
      expect(registerDevice).toHaveBeenCalledTimes(1);
    }, 15000);

    it("โหมด mock: ช่องเลือกมีป้ายข้อมูลตัวอย่าง (โหมดจริงไม่มี)", () => {
      central.value = {
        mode: "mock",
        reachable: true,
        devices: [box("ESP32-DEMO-01")],
      };
      const { unmount } = render(<RegisterDeviceForm />);
      expect(screen.getByText("ข้อมูลตัวอย่าง")).toBeInTheDocument();
      unmount();

      central.value = {
        mode: "real",
        reachable: true,
        devices: [box("BOX-0001")],
      };
      render(<RegisterDeviceForm />);
      expect(screen.queryByText("ข้อมูลตัวอย่าง")).not.toBeInTheDocument();
    });

    it("ไม่เสนอกล่องที่ลงทะเบียนในระบบเราไปแล้ว", async () => {
      central.value = {
        mode: "real",
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
      central.value = { mode: "real", reachable: false, devices: [] };
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

describe("RegisterDeviceForm: เตือนก่อนออกจากหน้าที่กรอกค้าง", () => {
  it("กรอกค้างแล้วกดยกเลิก: ถามก่อน ถ้าไม่ยืนยันลิงก์ไม่ถูกตาม", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RegisterDeviceForm />);

    await user.click(screen.getByRole("link", { name: "ยกเลิก" }));
    expect(confirm).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Device ID"), "DEV-9");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "ยกเลิก" }).dispatchEvent(click);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true);
    confirm.mockRestore();
  });
});
