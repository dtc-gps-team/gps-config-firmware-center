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
 * (ชื่อรุ่น + โปรโตคอลบังคับ, field ที่เหลือ optional) · 1 โมเดลมีได้
 * โปรโตคอลเดียว จึงเป็นช่องกรอกเดียว ไม่ใช่รายการ
 */
describe("CreateDeviceModelForm", () => {
  it("ปุ่ม 'เพิ่มโมเดล' disabled จนกว่าจะกรอกชื่อและโปรโตคอล", async () => {
    const user = userEvent.setup();
    render(<CreateDeviceModelForm onCreated={vi.fn()} />);

    const submitBtn = screen.getByRole("button", { name: "เพิ่มโมเดล" });
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByLabelText("ชื่อโมเดล"), "GT06N");
    expect(submitBtn).toBeDisabled(); // ยังไม่มีโปรโตคอล

    await user.type(screen.getByLabelText("โปรโตคอล"), "TCP");
    expect(submitBtn).not.toBeDisabled();
  });

  it("มีช่องโปรโตคอลช่องเดียว ไม่มีปุ่มเพิ่มรายการ (1 โมเดลมีได้โปรโตคอลเดียว)", () => {
    render(<CreateDeviceModelForm onCreated={vi.fn()} />);

    expect(screen.getAllByLabelText("โปรโตคอล")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "เพิ่ม" })).not.toBeInTheDocument();
    expect(screen.getByText("1 โมเดลมีได้โปรโตคอลเดียว")).toBeInTheDocument();
  });

  it("ส่ง payload ตรงกับที่กรอก รวม supportedProtocols และ field optional ที่เว้นว่างเป็น undefined", async () => {
    createDeviceModel.mockResolvedValue(createdModel);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreateDeviceModelForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText("ชื่อโมเดล"), "GT06N");
    await user.type(screen.getByLabelText("โปรโตคอล"), " TCP ");
    await user.click(screen.getByRole("button", { name: "เพิ่มโมเดล" }));

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
