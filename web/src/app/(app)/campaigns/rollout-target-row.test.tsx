import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Table, TableBody } from "@/components/ui/table";
import type {
  CampaignRolloutTarget,
  CampaignRolloutTargetAttempt,
} from "@/lib/campaign-api";
import { RolloutTargetRow } from "./rollout-target-row";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const attemptsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/campaign-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/campaign-api")>(
      "@/lib/campaign-api",
    );
  return { ...actual, listCampaignRolloutTargetAttempts: attemptsMock };
});

function attempt(
  n: number,
  status: string,
  detail: string | null = null,
): CampaignRolloutTargetAttempt {
  return {
    attemptNo: n,
    status,
    errorCode: null,
    detail,
    startedAt: "2026-11-09T03:00:00.000Z",
    finishedAt: null,
  };
}

function makeTarget(
  over: Partial<CampaignRolloutTarget>,
): CampaignRolloutTarget {
  return {
    id: "t-1",
    rolloutId: "r-1",
    deviceId: "DEV-0001",
    status: "pending",
    resultDetail: null,
    attemptCount: 1,
    nextRetryAt: null,
    lastAttempt: null,
    createdAt: "2026-11-09T03:00:00.000Z",
    updatedAt: "2026-11-09T03:00:05.000Z",
    ...over,
  };
}

function renderRow(target: CampaignRolloutTarget, maxAttempts = 3) {
  return render(
    <Table>
      <TableBody>
        <RolloutTargetRow
          campaignId="c-1"
          rolloutId="r-1"
          target={target}
          maxAttempts={maxAttempts}
        />
      </TableBody>
    </Table>,
  );
}

beforeEach(() => {
  attemptsMock.mockReset();
});

describe("RolloutTargetRow ลองส่งใหม่อัตโนมัติ", () => {
  it("รอบแรก: ไม่มีป้ายรอบ ไม่มีปุ่มประวัติ ไม่ยิง API", () => {
    renderRow(makeTarget({}));

    expect(screen.queryByText(/รอบ \d\/3/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ประวัติการส่ง/ }),
    ).not.toBeInTheDocument();
    expect(attemptsMock).not.toHaveBeenCalled();
  });

  it("รอส่งรอบใหม่: ป้ายรอบ 2/3 พร้อมนับถอยหลัง", () => {
    const soon = new Date(Date.now() + 45_000).toISOString();
    renderRow(makeTarget({ attemptCount: 1, nextRetryAt: soon }));

    expect(screen.getByText("รอบ 2/3")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/จะลองส่งใหม่ในอีก/);
  });

  it("ป้ายรอบตามค่าสูงสุดที่ส่งมาจาก API ไม่ใช่เลข 3 ตายตัว", () => {
    const soon = new Date(Date.now() + 45_000).toISOString();
    renderRow(makeTarget({ attemptCount: 1, nextRetryAt: soon }), 5);

    expect(screen.getByText("รอบ 2/5")).toBeInTheDocument();
  });

  it("ถึงเวลาแล้วแต่ยังไม่ได้ผล: ขึ้นว่าส่งรอบใหม่แล้ว รอกล่องตอบ ไม่ค้างที่ 0:00", () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    renderRow(makeTarget({ attemptCount: 1, nextRetryAt: past }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "ส่งรอบใหม่แล้ว รอกล่องตอบ",
    );
  });

  it("กางประวัติ: โหลดจาก API ตอนกางเท่านั้น แล้วแสดงทุกรอบ", async () => {
    attemptsMock.mockResolvedValue([
      attempt(1, "failed", "กล่องไม่ตอบ"),
      attempt(2, "succeeded"),
    ]);
    const user = userEvent.setup();
    renderRow(makeTarget({ status: "success", attemptCount: 2 }));
    expect(attemptsMock).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /ดูประวัติการส่งของ DEV-0001/ }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("apply-attempt-history")).toBeInTheDocument(),
    );
    expect(attemptsMock).toHaveBeenCalledWith("tok", "c-1", "r-1", "t-1");
    expect(screen.getByText("รอบ 1")).toBeInTheDocument();
    expect(screen.getByText("กล่องไม่ตอบ")).toBeInTheDocument();
    expect(screen.getByText("รอบ 2")).toBeInTheDocument();
  });

  it("โหลดประวัติไม่สำเร็จ: แสดงข้อความผิดพลาด", async () => {
    attemptsMock.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderRow(makeTarget({ status: "failed", attemptCount: 3 }));

    await user.click(screen.getByRole("button", { name: /ประวัติการส่ง/ }));

    await waitFor(() =>
      expect(
        screen.getByText("โหลดประวัติการส่งไม่สำเร็จ"),
      ).toBeInTheDocument(),
    );
  });
});
