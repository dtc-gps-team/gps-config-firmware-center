import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ApprovalQueueCard } from "./approval-queue-card";
import { CampaignRolloutApprovalCard } from "./campaign-rollout-approval-card";
import { DeviceFirmwareOverrideApprovalCard } from "./device-firmware-override-approval-card";
import type { CampaignRollout } from "@/lib/campaign-api";
import type { DeviceFirmwareOverride } from "@/lib/device-firmware-override-api";

/**
 * การ์ดทุกประเภทในคิว Approval Center ต้องวางข้อมูลและปุ่มตำแหน่งเดียวกัน
 * (A ทักว่าแต่ละการ์ดหน้าตาไม่ไปทางเดียวกัน) ชุดนี้ครอบโครงกลางและการ์ดที่
 * ย้ายมาใช้โครงกลางแล้ว
 */
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const auth = vi.hoisted(() => ({ role: "Operation", sub: "op-other" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: auth.role } }),
}));
vi.mock("@/lib/jwt", () => ({ getTokenSubject: () => auth.sub }));

vi.mock("@/hooks/use-firmware", () => ({
  useFirmware: () => ({
    data: { version: "2.5.0" },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function rollout(overrides: Partial<CampaignRollout> = {}): CampaignRollout {
  return {
    id: "r1",
    campaignId: "c1",
    payloadType: "config",
    configId: "cfg-1",
    firmwareId: null,
    status: "pending_approval",
    targetCount: 2,
    successCount: 0,
    failureCount: 0,
    createdBy: "op-creator",
    approvedBy: null,
    approvedAt: null,
    isRollback: false,
    rollbackOfId: null,
    createdAt: "2026-10-08T09:45:00Z",
    ...overrides,
  } as CampaignRollout;
}

const firmwareOverride: DeviceFirmwareOverride = {
  id: "fo-1",
  deviceId: "DEV-0126",
  firmwareId: "fw-1",
  versionNumber: 3,
  reason: "เครื่องนี้ต้องใช้รุ่นใหม่ก่อน",
  status: "pending",
  overriddenBy: "user-st-1",
  overriddenAt: "2026-10-12T08:00:00Z",
  decidedBy: null,
  decidedAt: null,
  rejectReason: null,
  consumedAt: null,
} as DeviceFirmwareOverride;

describe("ApprovalQueueCard (โครงกลาง)", () => {
  it("วางลำดับ: ข้อมูลหลัก -> ผู้ส่งคำขอ -> สรุป -> ปุ่ม และมีลิงก์เมื่อส่ง detailHref", () => {
    const { container } = render(
      <ApprovalQueueCard
        tag="Config"
        title="ชื่อเรื่อง"
        queuedAt="2026-10-12T08:00:00Z"
        detailHref="/somewhere"
        requesterName="สมชาย"
        summary={<span>ข้อมูลสรุป</span>}
        actions={<button type="button">ปุ่มตัดสินใจ</button>}
      />,
    );

    expect(
      screen.getByRole("link", { name: "ดูรายละเอียด →" }),
    ).toHaveAttribute("href", "/somewhere");
    const text = container.textContent ?? "";
    expect(text.indexOf("สมชาย")).toBeLessThan(text.indexOf("ข้อมูลสรุป"));
    expect(text.indexOf("ข้อมูลสรุป")).toBeLessThan(
      text.indexOf("ปุ่มตัดสินใจ"),
    );
  });

  it("ไม่ส่ง detailHref: ไม่มีลิงก์ดูรายละเอียด", () => {
    render(
      <ApprovalQueueCard
        tag="Firmware Override"
        title="DEV-0001"
        queuedAt="2026-10-12T08:00:00Z"
        requesterName="สมชาย"
        actions={null}
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("การ์ดค้างนานและการ์ดปกติมีขอบซ้ายกว้างเท่ากัน เนื้อหาจึงตรงแนว ต่างกันแค่สีขอบ", () => {
    const { container: fresh } = render(
      <ApprovalQueueCard
        tag="Campaign"
        title="ใหม่"
        queuedAt={new Date().toISOString()}
        requesterName="สมชาย"
        actions={null}
      />,
    );
    const { container: stale } = render(
      <ApprovalQueueCard
        tag="Campaign"
        title="ค้าง"
        queuedAt="2020-01-01T00:00:00Z"
        requesterName="สมชาย"
        actions={null}
      />,
    );

    const freshCard = fresh.firstElementChild as HTMLElement;
    const staleCard = stale.firstElementChild as HTMLElement;
    expect(freshCard.className).toContain("border-l-4");
    expect(staleCard.className).toContain("border-l-4");
    expect(freshCard.className).toContain("border-l-transparent");
    expect(staleCard.className).toContain("border-l-amber-500");
  });
});

describe("CampaignRolloutApprovalCard", () => {
  beforeEach(() => {
    auth.role = "Operation";
    auth.sub = "op-other";
  });

  it("แสดงชื่อผู้สร้าง และปุ่มตัดสินใจแบบไม่มีกล่องเทา (ไม่มีหัวข้อ 'อนุมัติ Rollout')", () => {
    render(
      <CampaignRolloutApprovalCard
        item={{ rollout: rollout(), campaignName: "ทดสอบ ui" }}
        creatorName="ผู้สร้างรอบนี้"
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByText(/ผู้สร้างรอบนี้/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
    expect(screen.queryByText("อนุมัติ Rollout")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ดูรายละเอียด →" }),
    ).toHaveAttribute("href", "/campaigns/c1/rollouts/r1");
  });

  it("เป็นผู้สร้างเอง: ปุ่มยังอยู่แต่กดไม่ได้ พร้อมเหตุผลให้ screen reader อ่าน", () => {
    auth.sub = "op-creator";

    render(
      <CampaignRolloutApprovalCard
        item={{ rollout: rollout(), campaignName: "ทดสอบ ui" }}
        creatorName="ผู้สร้างรอบนี้"
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ปฏิเสธ" })).toBeDisabled();
    expect(
      screen.getByText(/คุณเป็นผู้สร้าง Rollout นี้ อนุมัติหรือปฏิเสธของตัวเองไม่ได้/),
    ).toBeInTheDocument();
  });
});

describe("DeviceFirmwareOverrideApprovalCard", () => {
  it("ชื่อผู้ส่งคำขอแทน UUID, ป้าย 'Firmware Override' และเวอร์ชัน Firmware ที่ขอ", () => {
    render(
      <DeviceFirmwareOverrideApprovalCard
        item={firmwareOverride}
        requesterName="ช่างสมศรี"
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByText(/ช่างสมศรี/)).toBeInTheDocument();
    expect(screen.queryByText(/user-st-1/)).not.toBeInTheDocument();
    expect(screen.getByText("Firmware Override")).toBeInTheDocument();
    expect(screen.getByText("v2.5.0")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
