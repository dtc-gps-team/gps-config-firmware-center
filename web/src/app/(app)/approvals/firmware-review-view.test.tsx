import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ApprovalCenterEntry } from "./approval-center-entry";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const state = vi.hoisted(() => ({
  role: "QAEngineer",
  firmware: [] as unknown[],
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    isReady: true,
    session: { accessToken: "tok", role: state.role },
  }),
}));
vi.mock("@/hooks/use-firmware", () => ({
  useFirmwareList: () => ({
    data: state.firmware,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({ resolveName: (id: string) => `ชื่อของ ${id}` }),
}));
vi.mock("./approval-center-view", () => ({
  ApprovalCenterView: () => <div>คิวอนุมัติของ Operation</div>,
}));
vi.mock("@/components/refresh-control", () => ({ RefreshControl: () => null }));
vi.mock("@/components/app-shell/breadcrumb", () => ({
  useBreadcrumbTrail: () => {},
}));

function firmware(id: string, version: string, approvalStatus: string) {
  return {
    id,
    version,
    deviceModelCompatibility: ["GT06N"],
    uploadStatus: "stored",
    approvalStatus,
    fileSizeBytes: 2048,
    uploadedBy: "u-1",
    uploadedAt: "2026-10-20T09:00:00Z",
  };
}

describe("Approval Center ของ QAEngineer", () => {
  beforeEach(() => {
    state.role = "QAEngineer";
    state.firmware = [
      firmware("f1", "2.5.0", "pending_review"),
      firmware("f2", "2.4.1", "approved"),
    ];
  });

  it("เห็นเฉพาะ Firmware ที่รอตรวจคุณภาพ พร้อมปุ่มอนุมัติ/ปฏิเสธและลิงก์ไปรายละเอียด", () => {
    render(<ApprovalCenterEntry />);

    expect(screen.getByText("เวอร์ชัน 2.5.0")).toBeInTheDocument();
    expect(screen.queryByText("เวอร์ชัน 2.4.1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปฏิเสธ" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ดูรายละเอียด/ })).toHaveAttribute(
      "href",
      "/firmware/f1",
    );
    expect(
      screen.queryByText("คิวอนุมัติของ Operation"),
    ).not.toBeInTheDocument();
  });

  it("ไม่มี Firmware รอตรวจ: บอกว่าว่าง", () => {
    state.firmware = [firmware("f2", "2.4.1", "approved")];
    render(<ApprovalCenterEntry />);

    expect(
      screen.getByText(/ไม่มี Firmware รอตรวจคุณภาพตอนนี้/),
    ).toBeInTheDocument();
  });

  it("Role อื่น (Operation): เห็นคิวเดิม ไม่ใช่คิวตรวจคุณภาพ", () => {
    state.role = "Operation";
    render(<ApprovalCenterEntry />);

    expect(screen.getByText("คิวอนุมัติของ Operation")).toBeInTheDocument();
    expect(screen.queryByText("เวอร์ชัน 2.5.0")).not.toBeInTheDocument();
  });
});
