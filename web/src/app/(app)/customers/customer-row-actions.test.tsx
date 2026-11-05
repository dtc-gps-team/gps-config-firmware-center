import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CustomerRowActions } from "./customer-row-actions";
import type { ManagedCustomer } from "@/lib/customer-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Admin" } }),
}));

const updateCustomer = vi.fn();
const deleteCustomer = vi.fn();
vi.mock("@/lib/customer-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/customer-api")>(
      "@/lib/customer-api",
    );
  return {
    ...actual,
    updateCustomer: (...args: unknown[]) => updateCustomer(...args),
    deleteCustomer: (...args: unknown[]) => deleteCustomer(...args),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const activeCustomer: ManagedCustomer = {
  id: "c1",
  companyName: "Acme",
  isActive: true,
  contactName: "คุณสมชาย",
  email: "a@acme.test",
  phone: "0812345678",
  priorityTier: "gold",
  deviceCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("CustomerRowActions", () => {
  beforeEach(() => {
    updateCustomer.mockReset();
    deleteCustomer.mockReset();
  });

  it("ปิดใช้งาน: เรียก PATCH isActive=false แล้วแจ้ง onChanged · ปุ่มเปิดใช้งานเป็นสีปกติ ปุ่มปิดเป็นสีอันตราย", async () => {
    updateCustomer.mockResolvedValue({ ...activeCustomer, isActive: false });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CustomerRowActions customer={activeCustomer} onChanged={onChanged} />);

    const toggle = screen.getByRole("button", { name: "ปิดใช้งาน" });
    expect(toggle.className).toContain("bg-destructive/10");
    await user.click(toggle);

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(updateCustomer).toHaveBeenCalledWith("tok", "c1", {
      isActive: false,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("ลูกค้าที่ปิดใช้งานอยู่: ปุ่มเป็น 'เปิดใช้งาน' และส่ง isActive=true", async () => {
    const inactive = { ...activeCustomer, isActive: false };
    updateCustomer.mockResolvedValue({ ...inactive, isActive: true });
    const user = userEvent.setup();
    render(<CustomerRowActions customer={inactive} onChanged={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "เปิดใช้งาน" });
    expect(toggle.className).not.toContain("bg-destructive/10");
    await user.click(toggle);

    await waitFor(() =>
      expect(updateCustomer).toHaveBeenCalledWith("tok", "c1", {
        isActive: true,
      }),
    );
  });

  it("ยืนยันลบ: เรียก DELETE แล้วแจ้ง onChanged", async () => {
    deleteCustomer.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CustomerRowActions customer={activeCustomer} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "ลบ Acme" }));
    expect(screen.getByText("ลบลูกค้า Acme?")).toBeInTheDocument();
    expect(deleteCustomer).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ยืนยันลบ" }));

    await waitFor(() => expect(deleteCustomer).toHaveBeenCalledWith("tok", "c1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("มีเครื่องผูก (409): แสดงข้อความจาก backend ในกล่อง ไม่ปิดกล่อง ไม่เรียก onChanged", async () => {
    const { ApiError } = await import("@/lib/api");
    deleteCustomer.mockRejectedValue(
      new ApiError(
        'ลบลูกค้า "Acme" ไม่ได้ เพราะยังมีเครื่องผูกอยู่ 3 เครื่อง',
        409,
      ),
    );
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<CustomerRowActions customer={activeCustomer} onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: "ลบ Acme" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันลบ" }));

    expect(await screen.findByText(/ยังมีเครื่องผูกอยู่ 3 เครื่อง/)).toBeInTheDocument();
    expect(screen.getByText("ลบลูกค้า Acme?")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
