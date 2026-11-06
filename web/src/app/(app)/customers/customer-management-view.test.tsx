import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { CustomerManagementView } from "./customer-management-view";
import type { ManagedCustomer } from "@/lib/customer-api";

const authState = vi.hoisted(() => ({ role: "Admin" as string | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    isReady: true,
    session: { accessToken: "tok", role: authState.role },
  }),
}));

const base: ManagedCustomer = {
  id: "c1",
  companyName: "Acme",
  isActive: true,
  contactName: null,
  email: null,
  phone: null,
  priorityTier: null,
  deviceCount: 4,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const customers: ManagedCustomer[] = [
  base,
  { ...base, id: "c2", companyName: "Zeta", isActive: false, deviceCount: 0 },
];

vi.mock("@/hooks/use-managed-customers", () => ({
  useManagedCustomers: () => ({
    data: customers,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe("CustomerManagementView", () => {
  it("Role ที่ไม่มีสิทธิ์ (เช่น ConfigEngineer) ถูกบล็อกทั้งหน้า", () => {
    authState.role = "ConfigEngineer";
    render(<CustomerManagementView />);

    expect(screen.getByText("คุณไม่มีสิทธิ์เข้าถึงหน้านี้")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
  });

  it("Admin เห็นเฉพาะลูกค้าที่ใช้งานอยู่เป็นค่าเริ่มต้น พร้อมจำนวนเครื่องและปุ่มเพิ่มลูกค้า", () => {
    authState.role = "Admin";
    render(<CustomerManagementView />);

    expect(screen.getByRole("heading", { name: "Customer" })).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    // ลูกค้าที่ปิดใช้งานต้องเปลี่ยนตัวกรองสถานะเองถึงจะเห็น
    expect(screen.queryByText("Zeta")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /เพิ่มลูกค้า/ }).length,
    ).toBeGreaterThan(0);
  });
});
