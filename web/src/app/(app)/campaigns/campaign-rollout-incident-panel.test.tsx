import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CampaignRolloutIncidentPanel } from "./campaign-rollout-incident-panel";
import type { CampaignRollout, CampaignRolloutTarget } from "@/lib/campaign-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const authState = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { accessToken: "tok", role: authState.role },
  }),
}));

vi.mock("@/lib/campaign-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/campaign-api")>(
    "@/lib/campaign-api",
  );
  return {
    ...actual,
    resumeCampaignRollout: vi.fn(),
    rollbackCampaignRollout: vi.fn(),
  };
});

function makeRollout(overrides: Partial<CampaignRollout>): CampaignRollout {
  return {
    id: "rollout-1",
    campaignId: "campaign-1",
    payloadType: "Config",
    configId: "cfg-1",
    firmwareId: null,
    status: "paused",
    targetCount: 2,
    successCount: 1,
    failureCount: 1,
    createdBy: "op-1",
    approvedBy: "op-1",
    approvedAt: "2026-01-01T00:00:00Z",
    isRollback: false,
    rollbackOfId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTarget(
  overrides: Partial<CampaignRolloutTarget>,
): CampaignRolloutTarget {
  return {
    id: "target-1",
    rolloutId: "rollout-1",
    deviceId: "DEV-0001",
    status: "success",
    resultDetail: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("CampaignRolloutIncidentPanel — แสดงตาม status/role (#238 review comment ข้อ 3)", () => {
  it("status paused + role Operation -> เห็นปุ่ม Resume และ สั่ง Rollback ทั้งคู่", () => {
    authState.role = "Operation";
    render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "paused" })}
        targets={[]}
        onResumed={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "สั่ง Rollback" }),
    ).toBeInTheDocument();
  });

  it("status completed -> ไม่เห็นปุ่ม Resume (resumable เฉพาะ paused) แต่ยังสั่ง Rollback ได้", () => {
    authState.role = "Operation";
    render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "completed" })}
        targets={[]}
        onResumed={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Resume" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "สั่ง Rollback" }),
    ).toBeInTheDocument();
  });

  it("role ST (ไม่ใช่ Operation) -> ไม่เห็นปุ่มไหนเลย ไม่ render อะไร", () => {
    authState.role = "ST";
    const { container } = render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "paused" })}
        targets={[]}
        onResumed={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("status rejected -> ไม่ resumable และไม่ rollbackable ทั้งคู่ ไม่ render อะไร", () => {
    authState.role = "Operation";
    const { container } = render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "rejected" })}
        targets={[]}
        onResumed={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("CampaignRolloutIncidentPanel — เลือก/เอาเครื่องออกจาก Rollback", () => {
  it("กดเปิดแผง Rollback แล้วเอาเครื่องออก -> ตัวนับ included ลดลง", async () => {
    const user = userEvent.setup();
    authState.role = "Operation";
    render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "completed" })}
        targets={[
          makeTarget({ id: "t-1", deviceId: "DEV-0001", status: "success" }),
          makeTarget({ id: "t-2", deviceId: "DEV-0002", status: "success" }),
          makeTarget({ id: "t-3", deviceId: "DEV-0003", status: "failed" }), // ไม่ใช่ success -> ไม่อยู่ในลิสต์
        ]}
        onResumed={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "สั่ง Rollback" }));
    expect(screen.getByText(/2\/2 เครื่อง/)).toBeInTheDocument();

    // ทั้ง 2 เครื่องยัง included อยู่ทั้งคู่ -> label เหมือนกันทั้งคู่ กดตัวแรก
    await user.click(
      screen.getAllByRole("checkbox", {
        name: "เอาเครื่องนี้ออกจาก Rollback",
      })[0],
    );
    expect(screen.getByText(/1\/2 เครื่อง/)).toBeInTheDocument();
    // ปุ่มยืนยันยังกดได้ เพราะเหลืออย่างน้อย 1 เครื่อง
    expect(
      screen.getByRole("button", { name: "ยืนยันสั่ง Rollback" }),
    ).toBeEnabled();
  });
});

describe("CampaignRolloutIncidentPanel — targetsLoading/targetsError (#238 review comment ข้อ 5)", () => {
  it("targetsLoading=true -> โชว์ข้อความกำลังโหลด ไม่ใช่ข้อความ 'ยังไม่มีเครื่องสำเร็จ' หลอกๆ", () => {
    authState.role = "Operation";
    render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "completed" })}
        targets={[]}
        targetsLoading={true}
        onResumed={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "สั่ง Rollback" }));

    expect(screen.getByText("กำลังโหลดรายชื่อเครื่อง…")).toBeInTheDocument();
    expect(
      screen.queryByText("ยังไม่มีเครื่องที่ได้รับ payload ของรอบนี้สำเร็จเลย"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ยืนยันสั่ง Rollback" }),
    ).toBeDisabled();
  });

  it("targetsError -> โชว์ข้อความ error แทนตาราง และปิดปุ่มยืนยัน", () => {
    authState.role = "Operation";
    render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "completed" })}
        targets={[]}
        targetsError="โหลดรายชื่อเครื่องไม่สำเร็จ"
        onResumed={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "สั่ง Rollback" }));

    expect(screen.getByText("โหลดรายชื่อเครื่องไม่สำเร็จ")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ยืนยันสั่ง Rollback" }),
    ).toBeDisabled();
  });

  it("โหลดเสร็จแล้วจริงๆ ไม่มี error แต่ไม่มีเครื่องสำเร็จเลย -> โชว์ empty state ปกติ", () => {
    authState.role = "Operation";
    render(
      <CampaignRolloutIncidentPanel
        campaignId="campaign-1"
        rollout={makeRollout({ status: "completed" })}
        targets={[]}
        targetsLoading={false}
        targetsError={null}
        onResumed={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "สั่ง Rollback" }));

    expect(
      screen.getByText("ยังไม่มีเครื่องที่ได้รับ payload ของรอบนี้สำเร็จเลย"),
    ).toBeInTheDocument();
  });
});
