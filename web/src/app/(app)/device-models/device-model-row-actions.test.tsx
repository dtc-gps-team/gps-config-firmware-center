import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceModelRowActions } from "./device-model-row-actions";
import type { DeviceModel } from "@/lib/device-model-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Admin" } }),
}));

const updateDeviceModel = vi.fn();
const deleteDeviceModel = vi.fn();
vi.mock("@/lib/device-model-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/device-model-api")>(
    "@/lib/device-model-api",
  );
  return {
    ...actual,
    updateDeviceModel: (...args: unknown[]) => updateDeviceModel(...args),
    deleteDeviceModel: (...args: unknown[]) => deleteDeviceModel(...args),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const activeModel: DeviceModel = {
  id: "dm-1",
  name: "GT06N",
  manufacturer: null,
  supportedProtocols: ["TCP"],
  status: "active",
  warrantyMonths: null,
  endOfSupportDate: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/**
 * PR #273 review ข้อ 1(ค) — ปุ่มสลับ active/discontinued เรียก
 * `PATCH /device-models/{id}` (updateDeviceModel) ด้วย id + status ใหม่ที่
 * ถูกต้อง ทั้ง 2 ทิศทาง (active -> discontinued, discontinued -> active)
 */
describe("DeviceModelRowActions — toggle active", () => {
  it("กดจากสถานะ active -> เรียก updateDeviceModel(id, { status: 'discontinued' })", async () => {
    updateDeviceModel.mockResolvedValue({
      ...activeModel,
      status: "discontinued",
    });
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<DeviceModelRowActions model={activeModel} onUpdated={onUpdated} />);

    await user.click(screen.getByRole("button", { name: "ปรับเป็นเลิกผลิต" }));

    await waitFor(() => expect(updateDeviceModel).toHaveBeenCalledTimes(1));
    expect(updateDeviceModel).toHaveBeenCalledWith("tok", "dm-1", {
      status: "discontinued",
    });
    expect(onUpdated).toHaveBeenCalledWith({
      ...activeModel,
      status: "discontinued",
    });
  });

  it("กดจากสถานะ discontinued -> เรียก updateDeviceModel(id, { status: 'active' })", async () => {
    const discontinuedModel: DeviceModel = {
      ...activeModel,
      status: "discontinued",
    };
    updateDeviceModel.mockResolvedValue({ ...activeModel, status: "active" });
    const user = userEvent.setup();
    render(
      <DeviceModelRowActions model={discontinuedModel} onUpdated={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "ปรับเป็นยังผลิตอยู่" }));

    await waitFor(() => expect(updateDeviceModel).toHaveBeenCalledTimes(1));
    expect(updateDeviceModel).toHaveBeenCalledWith("tok", "dm-1", {
      status: "active",
    });
  });
});

/**
 * มติ A 2026-11-05: "เลิกผลิต" เป็นปุ่มหลัก · ลบจริงเฉพาะรุ่นที่ไม่มีอะไรอ้างอิง — ฝั่งเว็บไม่เดา
 * ล่วงหน้า ให้ backend ตัดสิน (409 + จำนวนที่อ้างอยู่) แล้วแสดงข้อความในกล่องยืนยัน
 */
describe("DeviceModelRowActions — ลบรุ่น", () => {
  it("ยืนยันลบ -> เรียก deleteDeviceModel(token, id) แล้วแจ้ง onDeleted", async () => {
    deleteDeviceModel.mockReset();
    deleteDeviceModel.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(
      <DeviceModelRowActions
        model={activeModel}
        onUpdated={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ลบ/ }));
    expect(screen.getByText("ลบรุ่น GT06N?")).toBeInTheDocument();
    expect(deleteDeviceModel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ยืนยันลบ" }));

    await waitFor(() => expect(deleteDeviceModel).toHaveBeenCalledTimes(1));
    expect(deleteDeviceModel).toHaveBeenCalledWith("tok", "dm-1");
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("มีของอ้างอิง (409) -> แสดงข้อความจาก backend ในกล่อง ไม่ปิดกล่อง ไม่เรียก onDeleted", async () => {
    deleteDeviceModel.mockReset();
    const { ApiError } = await import("@/lib/api");
    deleteDeviceModel.mockRejectedValue(
      new ApiError(
        'ลบรุ่น "GT06N" ไม่ได้ เพราะยังมีข้อมูลอ้างอิงอยู่: อุปกรณ์ 2 เครื่อง (รวมที่ปลดระวางแล้ว)',
        409,
      ),
    );
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(
      <DeviceModelRowActions
        model={activeModel}
        onUpdated={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ลบ/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันลบ" }));

    expect(await screen.findByText(/อุปกรณ์ 2 เครื่อง/)).toBeInTheDocument();
    expect(screen.getByText("ลบรุ่น GT06N?")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
