import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { DeviceApplyRequestCard } from "./device-apply-request-card";
import type {
  FieldApplyProgress,
  FieldApplyRequest,
} from "@/lib/field-apply-request-api";

const authState = vi.hoisted(() => ({ role: "Operation" as string }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: authState.role } }),
}));

const listFieldApplyRequests = vi.fn();
const getFieldApplyProgress = vi.fn();
vi.mock("@/lib/field-apply-request-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/field-apply-request-api")
  >("@/lib/field-apply-request-api");
  return {
    ...actual,
    listFieldApplyRequests: (...args: unknown[]) =>
      listFieldApplyRequests(...args),
    getFieldApplyProgress: (...args: unknown[]) =>
      getFieldApplyProgress(...args),
  };
});

function request(
  over: Partial<FieldApplyRequest> & { id: string },
): FieldApplyRequest {
  return {
    taskId: "t1",
    deviceId: "DEV-1",
    kind: "config",
    configId: "c1",
    firmwareId: null,
    overrideId: null,
    fromFirmwareVersion: null,
    isDowngrade: false,
    configAssignedBy: null,
    requestedBy: "u1",
    requestedAt: "2026-11-06T09:00:00Z",
    expiresAt: "2026-11-07T09:00:00Z",
    note: null,
    status: "sending",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    task: { id: "t1", title: "ติดตั้ง" },
    config: { id: "c1", name: "Config กลาง", deviceModel: "GT06N", protocol: "TCP" },
    firmware: null,
    requester: { id: "u1", fullName: "ช่างสมชาย" },
    configAssigner: null,
    decider: null,
    fieldNames: [],
    override: null,
    ...over,
  };
}

function progress(over: Partial<FieldApplyProgress>): FieldApplyProgress {
  return {
    requestId: "r1",
    kind: "config",
    status: "sending",
    fromVersion: null,
    toVersion: null,
    releasedAt: "2026-11-06T09:10:00Z",
    completedAt: null,
    retry: null,
    ...over,
  };
}

const attempt = (no: number, status: string, detail: string | null) => ({
  attemptNo: no,
  status,
  errorCode: null,
  detail,
  startedAt: "2026-11-06T09:10:00Z",
  finishedAt: null,
});

beforeEach(() => {
  authState.role = "Operation";
  listFieldApplyRequests.mockReset();
  getFieldApplyProgress.mockReset();
});

describe("DeviceApplyRequestCard", () => {
  it("รอรอบใหม่: ป้ายรอบ 2/3 + นับถอยหลัง + ประวัติรอบที่ 1 พร้อมสาเหตุ", async () => {
    listFieldApplyRequests.mockResolvedValue([request({ id: "r1" })]);
    getFieldApplyProgress.mockResolvedValue(
      progress({
        retry: {
          attemptNo: 1,
          maxAttempts: 3,
          nextRetryAt: new Date(Date.now() + 45_000).toISOString(),
          attempts: [attempt(1, "failed", "กล่องหลุดการเชื่อมต่อ")],
        },
      }),
    );
    render(<DeviceApplyRequestCard deviceId="DEV-1" />);

    expect(await screen.findByText("รอบ 2/3")).toBeInTheDocument();
    expect(screen.getByText("กำลังส่งเข้ากล่อง")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/จะลองส่งใหม่ในอีก 0:4\d/);
    expect(screen.getByTestId("apply-attempt-history")).toHaveTextContent(
      "กล่องหลุดการเชื่อมต่อ",
    );
    expect(getFieldApplyProgress).toHaveBeenCalledWith("tok", "t1", "r1");
  });

  it("ถึงเวลานับถอยหลังแล้ว: ขึ้น 'ส่งรอบใหม่แล้ว รอกล่องตอบ' ไม่ใช่ 0:00", async () => {
    listFieldApplyRequests.mockResolvedValue([request({ id: "r1" })]);
    getFieldApplyProgress.mockResolvedValue(
      progress({
        retry: {
          attemptNo: 1,
          maxAttempts: 3,
          nextRetryAt: new Date(Date.now() - 5_000).toISOString(),
          attempts: [attempt(1, "failed", "x")],
        },
      }),
    );
    render(<DeviceApplyRequestCard deviceId="DEV-1" />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "ส่งรอบใหม่แล้ว รอกล่องตอบ",
    );
  });

  it("ล้มครบ 3 ครั้ง: 'ส่ง 3 ครั้งไม่สำเร็จ' + สาเหตุรอบสุดท้าย + ประวัติครบ 3 รอบ ไม่มีนับถอยหลัง", async () => {
    listFieldApplyRequests.mockResolvedValue([
      request({ id: "r1", status: "failed" }),
    ]);
    getFieldApplyProgress.mockResolvedValue(
      progress({
        status: "failed",
        completedAt: "2026-11-06T09:15:00Z",
        retry: {
          attemptNo: 3,
          maxAttempts: 3,
          nextRetryAt: null,
          attempts: [
            attempt(1, "failed", "กล่องหลุด"),
            attempt(2, "failed", "กล่องไม่ตอบ"),
            attempt(3, "failed", "Firmware ใหม่ใช้งานไม่ได้หลังรีบูต"),
          ],
        },
      }),
    );
    render(<DeviceApplyRequestCard deviceId="DEV-1" />);

    expect(await screen.findByText("ส่ง 3 ครั้งไม่สำเร็จ")).toBeInTheDocument();
    expect(
      screen.getByText("สาเหตุรอบสุดท้าย: Firmware ใหม่ใช้งานไม่ได้หลังรีบูต"),
    ).toBeInTheDocument();
    expect(screen.getByText("รอบ 3/3")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByTestId("apply-attempt-history").querySelectorAll("li"),
    ).toHaveLength(3);
  });

  it("สำเร็จตั้งแต่รอบแรก: ไม่มีป้ายรอบและไม่มีประวัติ", async () => {
    listFieldApplyRequests.mockResolvedValue([
      request({ id: "r1", status: "succeeded" }),
    ]);
    getFieldApplyProgress.mockResolvedValue(
      progress({
        status: "succeeded",
        retry: {
          attemptNo: 1,
          maxAttempts: 3,
          nextRetryAt: null,
          attempts: [attempt(1, "succeeded", null)],
        },
      }),
    );
    render(<DeviceApplyRequestCard deviceId="DEV-1" />);

    expect(await screen.findByText("ส่งสำเร็จ")).toBeInTheDocument();
    expect(screen.queryByText(/^รอบ \d\/\d$/)).toBeNull();
    expect(screen.queryByTestId("apply-attempt-history")).toBeNull();
  });

  it("เลือกคำขอล่าสุดของเครื่องนี้เท่านั้น (ไม่ปนเครื่องอื่น/ใบเก่า)", async () => {
    listFieldApplyRequests.mockResolvedValue([
      request({ id: "old", requestedAt: "2026-11-05T09:00:00Z", status: "failed" }),
      request({ id: "other", deviceId: "DEV-2", requestedAt: "2026-11-06T11:00:00Z" }),
      request({ id: "new", taskId: "t9", requestedAt: "2026-11-06T10:00:00Z" }),
    ]);
    getFieldApplyProgress.mockResolvedValue(progress({ requestId: "new" }));
    render(<DeviceApplyRequestCard deviceId="DEV-1" />);

    await waitFor(() =>
      expect(getFieldApplyProgress).toHaveBeenCalledWith("tok", "t9", "new"),
    );
    expect(getFieldApplyProgress).toHaveBeenCalledTimes(1);
  });

  it("ยังไม่ปล่อยเข้ากล่อง (รออนุมัติ): แสดงสถานะ ไม่เรียก progress", async () => {
    listFieldApplyRequests.mockResolvedValue([
      request({ id: "r1", status: "pending" }),
    ]);
    render(<DeviceApplyRequestCard deviceId="DEV-1" />);

    expect(await screen.findByText("รออนุมัติ")).toBeInTheDocument();
    expect(getFieldApplyProgress).not.toHaveBeenCalled();
  });

  it("ไม่มีคำขอของเครื่องนี้ -> ไม่แสดงการ์ด · Role ที่อ่านคิวไม่ได้ (ConfigEngineer) -> ไม่ยิง API ไม่แสดง", async () => {
    listFieldApplyRequests.mockResolvedValue([
      request({ id: "x", deviceId: "DEV-2" }),
    ]);
    const { container, unmount } = render(
      <DeviceApplyRequestCard deviceId="DEV-1" />,
    );
    await waitFor(() => expect(listFieldApplyRequests).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    listFieldApplyRequests.mockClear();
    authState.role = "ConfigEngineer";
    const second = render(<DeviceApplyRequestCard deviceId="DEV-1" />);
    expect(listFieldApplyRequests).not.toHaveBeenCalled();
    expect(second.container).toBeEmptyDOMElement();
  });

  it("โหลดไม่สำเร็จ: แสดงข้อความผิดพลาดในการ์ดนี้เท่านั้น", async () => {
    const { ApiError } = await import("@/lib/api");
    listFieldApplyRequests.mockRejectedValue(new ApiError("ไม่มีสิทธิ์", 403));
    render(<DeviceApplyRequestCard deviceId="DEV-1" />);

    expect(await screen.findByText("ไม่มีสิทธิ์")).toBeInTheDocument();
  });
});
