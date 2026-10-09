import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceModelRowActions } from "./device-model-row-actions";
import type { DeviceModel } from "@/lib/device-model-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Admin" } }),
}));

const updateDeviceModel = vi.fn();
vi.mock("@/lib/device-model-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/device-model-api")>(
    "@/lib/device-model-api",
  );
  return {
    ...actual,
    updateDeviceModel: (...args: unknown[]) => updateDeviceModel(...args),
  };
});

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
