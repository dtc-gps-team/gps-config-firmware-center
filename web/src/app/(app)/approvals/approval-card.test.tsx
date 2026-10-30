import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({
    data: [
      { fieldName: "COMMAND_PASSWORD", sensitive: true, restartRequired: false },
      { fieldName: "SERVER_PORT", sensitive: false, restartRequired: true },
    ],
    isLoading: false,
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
    expect(screen.getByText("เทียบกับเวอร์ชัน 2")).toBeInTheDocument();
    expect(screen.getByText("แก้ไข 1")).toBeInTheDocument();
  });

  it("กด 'ดูค่าที่เปลี่ยน' แล้วเห็นค่าเดิม→ใหม่ ค่าอ่อนไหวถูกปิด และเตือนค่าที่ต้อง Restart", async () => {
    versionsState.data = [
      version(2, { COMMAND_PASSWORD: "old-secret", SERVER_PORT: 9000 }),
    ];
    const user = userEvent.setup();
    renderCard();

    expect(screen.queryByText("9000")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ดูค่าที่เปลี่ยน/ }));

    expect(screen.getByText("9000")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
    expect(screen.queryByText("old-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getByText(/ต้อง Restart กล่องหลังเปลี่ยน/)).toBeInTheDocument();
  });

  it("กดอนุมัติแล้วเห็นกล่องยืนยันที่บอกผลกระทบก่อนทำจริง", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "อนุมัติ" }));

    expect(
      await screen.findByText(/ยังไม่ถูกส่งเข้าอุปกรณ์จนกว่าจะเริ่ม Rollout/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันอนุมัติ" })).toBeInTheDocument();
  });

  it("ยังไม่เคยอนุมัติ: บอกว่าเป็นเวอร์ชันแรก", () => {
    versionsState.data = [];

    renderCard();

    expect(screen.getByText(/ยังไม่เคยอนุมัติ \(เวอร์ชันแรก\)/)).toBeInTheDocument();
  });
});
