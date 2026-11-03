import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FieldApplyRequestApprovalCard } from "./field-apply-request-approval-card";
import type { FieldApplyRequest } from "@/lib/field-apply-request-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

function makeItem(
  overrides: Partial<FieldApplyRequest> = {},
): FieldApplyRequest {
  return {
    id: "req-1",
    taskId: "task-1",
    deviceId: "DTC-0001",
    kind: "config",
    configId: "cfg-1",
    firmwareId: null,
    overrideId: null,
    fromFirmwareVersion: null,
    isDowngrade: false,
    configAssignedBy: null,
    requestedBy: "user-ot-1",
    requestedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T01:00:00Z",
    note: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    task: { id: "task-1", title: "ติดตั้งกล่อง DTC-0001" },
    config: {
      id: "cfg-1",
      name: "BOX ส่งพิกัดทุก 10 วินาที",
      deviceModel: "ESP32-DEVKIT-V1",
      protocol: "HTTP",
    },
    firmware: null,
    requester: { id: "user-ot-1", fullName: "ช่างสมศรี" },
    configAssigner: null,
    decider: null,
    fieldNames: ["gps.send_interval_sec"],
    override: null,
    ...overrides,
  };
}

describe("FieldApplyRequestApprovalCard", () => {
  it("canDecide=false -> แสดงข้อความแทนปุ่ม", () => {
    render(
      <FieldApplyRequestApprovalCard
        item={makeItem()}
        requesterName="ช่างสมศรี"
        canDecide={false}
        onDecided={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "อนุมัติ" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("เฉพาะ Operation เท่านั้นที่อนุมัติ/ปฏิเสธได้"),
    ).toBeInTheDocument();
  });

  it("ปุ่มยืนยันปฏิเสธกดไม่ได้จนกว่าจะกรอกเหตุผล และส่ง rejectReason ที่ trim แล้ว", async () => {
    const user = userEvent.setup();
    render(
      <FieldApplyRequestApprovalCard
        item={makeItem()}
        requesterName="ช่างสมศรี"
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ปฏิเสธ" }));
    const confirmButton = screen.getByRole("button", { name: "ยืนยันปฏิเสธ" });
    expect(confirmButton).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText("เหตุผลที่ปฏิเสธ (บังคับ)"),
      "  ลองใหม่  ",
    );
    expect(confirmButton).toBeEnabled();
  });

  it("kind=config -> แสดงรายชื่อ field ที่จะส่ง", () => {
    render(
      <FieldApplyRequestApprovalCard
        item={makeItem({
          fieldNames: ["gps.send_interval_sec", "led.enabled"],
        })}
        requesterName="ช่างสมศรี"
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByText("gps.send_interval_sec")).toBeInTheDocument();
    expect(screen.getByText("led.enabled")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();
  });

  it("แสดงป้ายมีค่าที่แก้เฉพาะเมื่อคำขอมี override", () => {
    const { rerender } = render(
      <FieldApplyRequestApprovalCard
        item={makeItem()}
        requesterName="ช่างสมศรี"
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );
    expect(screen.queryByText("มีค่าที่แก้")).not.toBeInTheDocument();

    rerender(
      <FieldApplyRequestApprovalCard
        item={makeItem({
          override: {
            id: "ov-1",
            reason: "ปรับค่า",
            fieldNames: ["gps.send_interval_sec"],
          },
        })}
        requesterName="ช่างสมศรี"
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );
    expect(screen.getByText("มีค่าที่แก้")).toBeInTheDocument();
  });

  it("kind=firmware -> แสดง from → to และป้ายถอยเวอร์ชันเมื่อ isDowngrade", () => {
    render(
      <FieldApplyRequestApprovalCard
        item={makeItem({
          kind: "firmware",
          configId: null,
          config: null,
          firmwareId: "fw-1",
          firmware: { id: "fw-1", version: "1.0.0" },
          fromFirmwareVersion: "2.0.0",
          isDowngrade: true,
          fieldNames: [],
        })}
        requesterName="ช่างสมศรี"
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByText("Firmware")).toBeInTheDocument();
    expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText("(ถอยเวอร์ชัน)")).toBeInTheDocument();
  });

  it("myUserId === requestedBy -> ซ่อนปุ่มล่วงหน้าก่อนโดน backend 403 (SoD)", () => {
    render(
      <FieldApplyRequestApprovalCard
        item={makeItem({ requestedBy: "op-1" })}
        requesterName="ช่างสมศรี"
        canDecide={true}
        myUserId="op-1"
        onDecided={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "อนุมัติ" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/ผู้ส่งคำขอนี้เอง/)).toBeInTheDocument();
  });

  it("myUserId === configAssignedBy (kind=config) -> ซ่อนปุ่มล่วงหน้า (SoD)", () => {
    render(
      <FieldApplyRequestApprovalCard
        item={makeItem({ configAssignedBy: "op-2" })}
        requesterName="ช่างสมศรี"
        canDecide={true}
        myUserId="op-2"
        onDecided={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "อนุมัติ" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/ผู้ผูก Config เข้างานนี้/)).toBeInTheDocument();
  });

  it("myUserId ไม่ตรงใครเลย -> เห็นปุ่มตามปกติ", () => {
    render(
      <FieldApplyRequestApprovalCard
        item={makeItem({ requestedBy: "user-ot-1", configAssignedBy: "op-2" })}
        requesterName="ช่างสมศรี"
        canDecide={true}
        myUserId="op-other"
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
  });
});
