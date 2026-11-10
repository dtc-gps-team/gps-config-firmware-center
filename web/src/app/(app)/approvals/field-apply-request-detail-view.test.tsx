import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { FieldApplyRequestDetailView } from "./field-apply-request-detail-view";
import type {
  FieldApplyProgress,
  FieldApplyRequest,
} from "@/lib/field-apply-request-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));
vi.mock("@/lib/jwt", () => ({ getTokenSubject: () => "user-op-1" }));

const state = vi.hoisted(() => ({
  request: {
    data: null as unknown,
    progress: null as unknown,
    isLoading: false,
    error: null as string | null,
  },
  overrideCalls: [] as string[],
}));

vi.mock("@/hooks/use-field-apply-request", () => ({
  useFieldApplyRequest: () => ({ ...state.request, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-device-config-override", () => ({
  useDeviceConfigOverride: (id: string) => {
    state.overrideCalls.push(id);
    return {
      data: {
        id,
        configId: "cfg-1",
        fields: { "gps.send_interval_sec": 10 },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("./config-field-value-list", () => ({
  ConfigFieldValueList: ({
    configId,
    fieldNames,
  }: {
    configId: string;
    fieldNames: string[];
  }) => (
    <div data-testid="values" data-config={configId}>
      {fieldNames.map((n) => (
        <span key={n}>{n}</span>
      ))}
    </div>
  ),
}));
vi.mock("./override-field-diff-list", () => ({
  OverrideFieldDiffList: ({ fields }: { fields: Record<string, unknown> }) => (
    <div data-testid="diff">{JSON.stringify(fields)}</div>
  ),
}));

function makeItem(
  overrides: Partial<FieldApplyRequest> = {},
): FieldApplyRequest {
  return {
    id: "req-1",
    taskId: "task-1",
    deviceId: "BOX-0001",
    kind: "config",
    configId: "cfg-1",
    firmwareId: null,
    overrideId: null,
    fromFirmwareVersion: null,
    isDowngrade: false,
    configAssignedBy: null,
    requestedBy: "user-st-1",
    requestedAt: "2026-11-10T07:31:00Z",
    expiresAt: "2026-11-11T07:31:00Z",
    note: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    task: { id: "task-1", title: "BOX-0001 งานติดตั้ง" },
    config: {
      id: "cfg-1",
      name: "BOX-0001 v1.0.0",
      deviceModel: "ESP32-DEVKIT-V1",
      protocol: "HTTP",
    },
    firmware: null,
    requester: { id: "user-st-1", fullName: "ST Tester" },
    configAssigner: null,
    decider: null,
    fieldNames: ["gps.send_interval_sec"],
    override: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.request = { data: null, progress: null, isLoading: false, error: null };
  state.overrideCalls = [];
});

describe("FieldApplyRequestDetailView", () => {
  it("รออนุมัติ: แสดงข้อมูลคำขอ field ที่จะส่ง และปุ่มอนุมัติ/ปฏิเสธ", () => {
    state.request.data = makeItem();
    render(<FieldApplyRequestDetailView id="req-1" />);

    expect(screen.getByText("ST Tester")).toBeInTheDocument();
    expect(screen.getByText("gps.send_interval_sec")).toBeInTheDocument();
    expect(screen.getByTestId("values")).toHaveAttribute("data-config", "cfg-1");
    expect(screen.getByRole("link", { name: "BOX-0001 v1.0.0" })).toHaveAttribute(
      "href",
      "/config/cfg-1",
    );
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
    expect(screen.getByText("หมดเวลาอนุมัติ")).toBeInTheDocument();
  });

  it("มี Override: โหลดค่าที่ขอแก้มาแสดง", () => {
    state.request.data = makeItem({
      overrideId: "ov-9",
      override: {
        id: "ov-9",
        reason: "ลูกค้าขอส่งถี่ขึ้น",
        fieldNames: ["gps.send_interval_sec"],
      },
    });
    render(<FieldApplyRequestDetailView id="req-1" />);

    expect(state.overrideCalls).toContain("ov-9");
    expect(screen.getByText("เหตุผล: ลูกค้าขอส่งถี่ขึ้น")).toBeInTheDocument();
    expect(screen.getByTestId("diff")).toHaveTextContent(
      '{"gps.send_interval_sec":10}',
    );
  });

  it("ถูกปฏิเสธแล้ว: ไม่มีปุ่ม แสดงผู้ปฏิเสธและเหตุผล", () => {
    state.request.data = makeItem({
      status: "rejected",
      decidedBy: "user-op-2",
      decidedAt: "2026-11-10T08:00:00Z",
      decider: { id: "user-op-2", fullName: "Operation B" },
      rejectReason: "ค่าไม่ถูกต้อง",
    });
    render(<FieldApplyRequestDetailView id="req-1" />);

    expect(screen.queryByRole("button", { name: "อนุมัติ" })).not.toBeInTheDocument();
    expect(screen.getByText("ปฏิเสธโดย")).toBeInTheDocument();
    expect(screen.getByText("Operation B")).toBeInTheDocument();
    expect(screen.getByText("เหตุผลที่ปฏิเสธ: ค่าไม่ถูกต้อง")).toBeInTheDocument();
    expect(screen.queryByText("หมดเวลาอนุมัติ")).not.toBeInTheDocument();
  });

  it("ส่งไม่สำเร็จหลังลองครบ: แสดงสถานะจากความคืบหน้าและรอบ", () => {
    state.request.data = makeItem({ status: "failed" });
    state.request.progress = {
      requestId: "req-1",
      kind: "config",
      status: "failed",
      fromVersion: null,
      toVersion: null,
      releasedAt: "2026-11-10T09:00:00Z",
      completedAt: "2026-11-10T09:02:00Z",
      retry: {
        attemptNo: 3,
        maxAttempts: 3,
        nextRetryAt: null,
        attempts: [1, 2, 3].map((n) => ({
          attemptNo: n,
          status: "failed",
          errorCode: "TIMEOUT",
          detail: "กล่องไม่ตอบ",
          startedAt: "2026-11-10T09:00:00Z",
          finishedAt: "2026-11-10T09:00:10Z",
        })),
      },
    } satisfies FieldApplyProgress;
    render(<FieldApplyRequestDetailView id="req-1" />);

    expect(screen.getByTestId("field-apply-progress")).toBeInTheDocument();
    expect(screen.getByText("รอบ 3/3")).toBeInTheDocument();
    expect(screen.getByText("กดส่งเมื่อ")).toBeInTheDocument();
  });

  it("คำขอ Firmware: แสดงจากเวอร์ชันไปเวอร์ชันและเตือนถอยเวอร์ชัน", () => {
    state.request.data = makeItem({
      kind: "firmware",
      configId: null,
      config: null,
      firmwareId: "fw-1",
      firmware: { id: "fw-1", version: "1.0.0" },
      fromFirmwareVersion: "1.2.0",
      isDowngrade: true,
      fieldNames: [],
    });
    render(<FieldApplyRequestDetailView id="req-1" />);

    expect(screen.getByText("Firmware ที่จะส่ง")).toBeInTheDocument();
    expect(screen.getByText("1.2.0")).toBeInTheDocument();
    expect(screen.getByText(/ถอยเวอร์ชัน Firmware/)).toBeInTheDocument();
  });

  it("โหลดไม่สำเร็จ: แสดงข้อความและลิงก์กลับ", () => {
    state.request.error = "ไม่พบคำขอส่งเข้ากล่องนี้";
    render(<FieldApplyRequestDetailView id="req-1" />);

    expect(screen.getByText("ไม่พบคำขอส่งเข้ากล่องนี้")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "กลับไป Approval Center" }),
    ).toHaveAttribute("href", "/approvals");
  });
});
