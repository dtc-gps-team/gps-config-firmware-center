import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CustomerForm } from "./customer-form";
import type { ManagedCustomer } from "@/lib/customer-api";

const authState = vi.hoisted(() => ({ role: "Admin" as string | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: authState.role } }),
}));

const createCustomer = vi.fn();
const updateCustomer = vi.fn();
vi.mock("@/lib/customer-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/customer-api")>(
      "@/lib/customer-api",
    );
  return {
    ...actual,
    createCustomer: (...args: unknown[]) => createCustomer(...args),
    updateCustomer: (...args: unknown[]) => updateCustomer(...args),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const saved: ManagedCustomer = {
  id: "c1",
  companyName: "Acme",
  isActive: true,
  contactName: null,
  email: null,
  phone: null,
  priorityTier: null,
  deviceCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("CustomerForm", () => {
  beforeEach(() => {
    authState.role = "Admin";
    createCustomer.mockReset();
    updateCustomer.mockReset();
  });

  it("เพิ่มใหม่: ชื่อบริษัทบังคับ (ว่าง = กดไม่ได้) ส่งเฉพาะช่องที่กรอก ตัดช่องว่างหัวท้าย", async () => {
    createCustomer.mockResolvedValue(saved);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<CustomerForm onSaved={onSaved} />);

    const submit = screen.getByRole("button", { name: "เพิ่มลูกค้า" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("ชื่อบริษัท"), "  Acme  ");
    await user.type(screen.getByLabelText(/ผู้ติดต่อ/), "คุณสมชาย");
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(createCustomer).toHaveBeenCalledWith("tok", {
      companyName: "Acme",
      contactName: "คุณสมชาย",
      email: undefined,
      phone: undefined,
      priorityTier: undefined,
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("แก้ไข: เติมค่าเดิม และช่องที่เว้นว่างส่ง null เพื่อล้างค่า", async () => {
    updateCustomer.mockResolvedValue(saved);
    const user = userEvent.setup();
    render(
      <CustomerForm
        customer={{ ...saved, contactName: "คุณสมชาย", phone: "0812345678" }}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("ชื่อบริษัท")).toHaveValue("Acme");
    await user.clear(screen.getByLabelText(/ผู้ติดต่อ/));
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(updateCustomer).toHaveBeenCalledWith("tok", "c1", {
      companyName: "Acme",
      contactName: null,
      email: null,
      phone: "0812345678",
      priorityTier: null,
    });
  });

  it("ชื่อซ้ำ (409): แสดงข้อความจาก backend ในฟอร์ม ไม่เรียก onSaved", async () => {
    const { ApiError } = await import("@/lib/api");
    createCustomer.mockRejectedValue(
      new ApiError('มีลูกค้าชื่อ "Acme" อยู่แล้ว', 409),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<CustomerForm onSaved={onSaved} />);

    await user.type(screen.getByLabelText("ชื่อบริษัท"), "Acme");
    await user.click(screen.getByRole("button", { name: "เพิ่มลูกค้า" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("มีลูกค้าชื่อ");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Role ที่ไม่ใช่ Admin/SuperAdmin เห็นข้อความไม่มีสิทธิ์แทนฟอร์ม", () => {
    authState.role = "Operation";
    render(<CustomerForm onSaved={vi.fn()} />);

    expect(
      screen.getByText(/เฉพาะ Role Admin\/SuperAdmin/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อบริษัท")).not.toBeInTheDocument();
  });
});
