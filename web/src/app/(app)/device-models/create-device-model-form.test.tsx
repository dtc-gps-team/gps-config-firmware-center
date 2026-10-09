import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateDeviceModelForm } from "./create-device-model-form";
import type { DeviceModel } from "@/lib/device-model-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Admin" } }),
}));

const createDeviceModel = vi.fn();
vi.mock("@/lib/device-model-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/device-model-api")>(
    "@/lib/device-model-api",
  );
  return {
    ...actual,
    createDeviceModel: (...args: unknown[]) => createDeviceModel(...args),
  };
});

const createdModel: DeviceModel = {
  id: "dm-new",
  name: "GT06N",
  manufacturer: "Concox",
  supportedProtocols: ["TCP"],
  status: "active",
  warrantyMonths: 12,
  endOfSupportDate: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/**
 * PR #273 review ข้อ 1(ข) — ฟอร์มสร้างรุ่น validate + ส่ง payload ถูกต้อง
 * (ชื่อรุ่น + protocol อย่างน้อย 1 รายการบังคับ, field ที่เหลือ optional)
 */
describe("CreateDeviceModelForm", () => {
  it("ปุ่ม 'เพิ่มรุ่นอุปกรณ์' disabled จนกว่าจะกรอกชื่อ + เพิ่ม protocol อย่างน้อย 1 รายการ", async () => {
    const user = userEvent.setup();
    render(<CreateDeviceModelForm onCreated={vi.fn()} />);

    const submitBtn = screen.getByRole("button", { name: "เพิ่มรุ่นอุปกรณ์" });
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByLabelText("ชื่อรุ่น"), "GT06N");
    expect(submitBtn).toBeDisabled(); // ยังไม่มี protocol

    await user.type(screen.getByPlaceholderText("เช่น TCP"), "TCP");
    await user.click(screen.getByRole("button", { name: "เพิ่ม" }));
    expect(submitBtn).not.toBeDisabled();
  });

  it("ส่ง payload ตรงกับที่กรอก รวม supportedProtocols และ field optional ที่เว้นว่างเป็น undefined", async () => {
    createDeviceModel.mockResolvedValue(createdModel);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreateDeviceModelForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText("ชื่อรุ่น"), "GT06N");
    await user.type(screen.getByPlaceholderText("เช่น TCP"), "TCP");
    await user.click(screen.getByRole("button", { name: "เพิ่ม" }));
    await user.click(screen.getByRole("button", { name: "เพิ่มรุ่นอุปกรณ์" }));

    await waitFor(() => expect(createDeviceModel).toHaveBeenCalledTimes(1));
    expect(createDeviceModel).toHaveBeenCalledWith("tok", {
      name: "GT06N",
      manufacturer: undefined,
      supportedProtocols: ["TCP"],
      status: "active",
      warrantyMonths: undefined,
      endOfSupportDate: undefined,
      notes: undefined,
    });
    expect(onCreated).toHaveBeenCalledWith(createdModel);
  });
});
