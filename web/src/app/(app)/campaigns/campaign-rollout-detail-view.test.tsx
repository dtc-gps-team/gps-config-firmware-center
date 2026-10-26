import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { CampaignRolloutDetailView } from "./campaign-rollout-detail-view";
import type {
  CampaignRollout,
  CampaignRolloutTarget,
} from "@/lib/campaign-api";

const rolloutQuery = vi.hoisted(() => ({
  value: {} as { data: unknown; isLoading: boolean; error: string | null },
  refetch: vi.fn(),
}));
const targetsQuery = vi.hoisted(() => ({
  value: {} as {
    data: unknown;
    isLoading: boolean;
    error: string | null;
  },
  refetch: vi.fn(),
}));

vi.mock("@/hooks/use-campaign-rollout", () => ({
  useCampaignRollout: () => ({
    ...rolloutQuery.value,
    refetch: rolloutQuery.refetch,
  }),
}));
vi.mock("@/hooks/use-campaign-rollout-targets", () => ({
  useCampaignRolloutTargets: () => ({
    ...targetsQuery.value,
    refetch: targetsQuery.refetch,
  }),
}));
vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({ data: null }),
}));
vi.mock("@/hooks/use-firmware", () => ({
  useFirmware: () => ({ data: null }),
}));
// แผงอนุมัติ/ปล่อย/Incident มีเทสของตัวเองแล้ว ไม่เกี่ยวกับการ์ดผลต่อเครื่อง
vi.mock("./campaign-rollout-approval-panel", () => ({
  CampaignRolloutApprovalPanel: () => null,
}));
vi.mock("./campaign-rollout-release-panel", () => ({
  CampaignRolloutReleasePanel: () => null,
}));
vi.mock("./campaign-rollout-incident-panel", () => ({
  CampaignRolloutIncidentPanel: () => null,
}));

function rollout(over: Partial<CampaignRollout> = {}): CampaignRollout {
  return {
    id: "r-1",
    campaignId: "c-1",
    payloadType: "Config",
    configId: "cfg-1",
    firmwareId: null,
    status: "active",
    targetCount: 3,
    successCount: 0,
    failureCount: 0,
    createdBy: "u",
    approvedBy: null,
    approvedAt: null,
    isRollback: false,
    rollbackOfId: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...over,
  } as CampaignRollout;
}

function target(
  deviceId: string,
  status: CampaignRolloutTarget["status"],
  resultDetail: string | null = null,
): CampaignRolloutTarget {
  return {
    id: `t-${deviceId}`,
    rolloutId: "r-1",
    deviceId,
    status,
    resultDetail,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:05.000Z",
  };
}

function setup(r: CampaignRollout, targets: CampaignRolloutTarget[]) {
  rolloutQuery.value = { data: r, isLoading: false, error: null };
  targetsQuery.value = { data: targets, isLoading: false, error: null };
  return render(<CampaignRolloutDetailView campaignId="c-1" rolloutId="r-1" />);
}

describe("CampaignRolloutDetailView: การ์ดผลต่อเครื่อง", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rolloutQuery.refetch.mockReset();
    targetsQuery.refetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("เครื่องที่ข้ามเพราะออฟไลน์ไม่ถูกแสดงเป็นล้มเหลว", () => {
    setup(rollout({ status: "completed" }), [
      target("D1", "success"),
      target("D2", "skipped_offline", "กล่องออฟไลน์ ไม่ได้รับ Config"),
    ]);

    expect(screen.getByText("ข้าม (ออฟไลน์)")).toBeInTheDocument();
    expect(screen.queryByText("ล้มเหลว")).not.toBeInTheDocument();
  });

  it("สรุปจำนวนรายสถานะอยู่ใต้แถบความคืบหน้า", () => {
    setup(rollout({ status: "completed" }), [
      target("D1", "success"),
      target("D2", "success"),
      target("D3", "failed", "Server กลางรายงาน FAILED"),
      target("D4", "skipped_offline"),
    ]);

    // สรุปจำนวนอยู่ใต้แถบความคืบหน้า (การ์ดเดียว ไม่ซ้ำกับหัวตาราง)
    expect(screen.getByText("สำเร็จ 2")).toBeInTheDocument();
    expect(screen.getByText("ล้มเหลว 1")).toBeInTheDocument();
    expect(screen.getByText("ข้าม 1")).toBeInTheDocument();
    expect(screen.getByText("รอผล 0")).toBeInTheDocument();
  });

  it("เหตุผลยาวๆ ไม่ถูกตัด ขึ้นบรรทัดใหม่แทน", () => {
    const long =
      "Server กลางรายงาน FAILED VALIDATION_FAILED data_server.host ไม่อยู่ใน allowlist";
    setup(rollout({ status: "completed" }), [target("D1", "failed", long)]);

    const cell = screen.getByText(long);
    expect(cell.className).toContain("whitespace-normal");
    expect(cell.className).not.toContain("truncate");
  });

  it("ยังมีเครื่องรอผลขณะ active: บอกว่ากำลังรอ และรีเฟรชทั้ง Rollout กับผลรายเครื่องทุก 5 วินาที", () => {
    setup(rollout({ status: "active" }), [
      target("D1", "success"),
      target("D2", "pending"),
    ]);

    expect(screen.getByText(/รีเฟรชอัตโนมัติทุก 5 วินาที/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(rolloutQuery.refetch).toHaveBeenCalledTimes(1);
    expect(targetsQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("ได้ผลครบแล้ว: ไม่รีเฟรชอัตโนมัติและไม่แสดงข้อความรอ", () => {
    setup(rollout({ status: "completed" }), [
      target("D1", "success"),
      target("D2", "failed"),
    ]);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(rolloutQuery.refetch).not.toHaveBeenCalled();
    expect(targetsQuery.refetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/รีเฟรชอัตโนมัติ/)).not.toBeInTheDocument();
  });

  it("Rollout ยังไม่ปล่อย (เครื่อง pending ทั้งหมด): ไม่รีเฟรชอัตโนมัติ", () => {
    setup(rollout({ status: "approved" }), [target("D1", "pending")]);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(targetsQuery.refetch).not.toHaveBeenCalled();
  });

  it("หลังปล่อย: มีแถบความคืบหน้า นับทุกเครื่องที่ได้ผลแล้วเป็นเปอร์เซ็นต์", () => {
    setup(rollout({ status: "active" }), [
      target("D1", "success"),
      target("D2", "failed"),
      target("D3", "skipped_offline"),
      target("D4", "pending"),
    ]);

    const bar = screen.getByRole("progressbar", {
      name: "ความคืบหน้าของ Rollout",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByText("75% ได้ผลแล้ว")).toBeInTheDocument();
    expect(screen.getByText("3 / 4 เครื่อง")).toBeInTheDocument();
    expect(screen.getByText("กำลังส่ง Config ให้ 4 เครื่อง")).toBeInTheDocument();
  });

  it("ได้ผลครบ: 100% และหัวข้อเป็นเสร็จสิ้น", () => {
    setup(rollout({ status: "completed" }), [
      target("D1", "success"),
      target("D2", "failed"),
    ]);

    expect(screen.getByText("100% ได้ผลแล้ว")).toBeInTheDocument();
    expect(screen.getByText("ส่ง Config ให้ 2 เครื่องเสร็จสิ้น")).toBeInTheDocument();
  });

  it("Rollout หยุดชั่วคราว (Auto Pause): หัวข้อบอกว่าหยุดชั่วคราว", () => {
    setup(rollout({ status: "paused" }), [
      target("D1", "failed"),
      target("D2", "pending"),
    ]);

    expect(screen.getByText(/หยุดชั่วคราว การส่ง Config ให้ 2 เครื่อง/)).toBeInTheDocument();
  });

  it("ก่อนปล่อย (รออนุมัติ/อนุมัติแล้ว): ไม่แสดงแถบความคืบหน้า", () => {
    setup(rollout({ status: "approved" }), [target("D1", "pending")]);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
