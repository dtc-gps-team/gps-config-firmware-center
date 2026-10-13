import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ApprovalCard } from "./approval-card";
import type { PendingApproval } from "@/hooks/use-pending-approvals";
import type { ConfigVersion } from "@/lib/config-api";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const versionsState = vi.hoisted(() => ({
  data: null as ConfigVersion[] | null,
}));
vi.mock("@/hooks/use-config-versions", () => ({
  useConfigVersions: () => ({
    data: versionsState.data,
    isLoading: versionsState.data === null,
    error: null,
    refetch: vi.fn(),
  }),
}));

function version(versionNumber: number, fields: Record<string, unknown>) {
  return {
    id: `v${versionNumber}`,
    configId: "cfg-1",
    versionNumber,
    deviceModel: "GT06N",
    protocol: "TCP",
    fields,
    approvedBy: "op-1",
    approvedAt: "2026-01-01T00:00:00Z",
  } satisfies ConfigVersion;
}

const item: PendingApproval = {
  id: "cfg-1",
  name: "Test Config",
  deviceModel: "GT06N",
  protocol: "TCP",
  createdBy: "user-1",
  description: null,
  fields: { COMMAND_PASSWORD: "s3cr3t", SERVER_PORT: 8080 },
  queuedAt: "2026-01-01T00:00:00Z",
  suggestedApprover: null,
};

function renderCard() {
  render(
    <ApprovalCard
      item={item}
      creatorName="สมชาย ใจดี"
      canDecide={true}
      onDecided={vi.fn()}
    />,
  );
}

describe("ApprovalCard", () => {
  beforeEach(() => {
    versionsState.data = null;
  });

  it("แสดงชื่อผู้สร้างแทน UUID", () => {
    renderCard();

    expect(screen.getByText(/สมชาย ใจดี/)).toBeInTheDocument();
    expect(screen.queryByText("user-1")).not.toBeInTheDocument();
  });

  it("มีลิงก์ไปหน้ารายละเอียดคำขออนุมัติของ Config นี้ และไม่โชว์ค่า Config บนการ์ดอีก", () => {
    renderCard();

    expect(
      screen.getByRole("link", { name: "ดูรายละเอียด →" }),
    ).toHaveAttribute("href", "/approvals/config/cfg-1");
    // ค่าทั้งหมด (รวมค่า sensitive) ย้ายไปอยู่หน้ารายละเอียดที่ mask เอง
    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.queryByText("8080")).not.toBeInTheDocument();
  });

  it("ยังมีปุ่มอนุมัติและปฏิเสธบนการ์ดเหมือนเดิม", () => {
    renderCard();

    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปฏิเสธ" })).toBeInTheDocument();
  });

  it("เคยอนุมัติแล้ว: บอกจำนวนค่าที่เปลี่ยนเทียบเวอร์ชันล่าสุด (ใช้เวอร์ชันเลขมากสุด ไม่พึ่งลำดับที่ส่งมา)", () => {
    versionsState.data = [
      version(1, { SERVER_PORT: 1 }),
      version(2, { COMMAND_PASSWORD: "s3cr3t", SERVER_PORT: 9000 }),
    ];

    renderCard();

    // v2 -> ใหม่: SERVER_PORT แก้ 1 ค่า (COMMAND_PASSWORD เท่าเดิม)
    expect(
      screen.getByText("เปลี่ยนจากเวอร์ชัน 2 จำนวน 1 ค่า"),
    ).toBeInTheDocument();
  });

  it("ยังไม่เคยอนุมัติ: บอกว่าเป็นเวอร์ชันแรก", () => {
    versionsState.data = [];

    renderCard();

    expect(
      screen.getByText("ยังไม่เคยอนุมัติ (เวอร์ชันแรก)"),
    ).toBeInTheDocument();
  });
});
