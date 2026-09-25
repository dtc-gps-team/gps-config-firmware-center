import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { DeviceConfigOverrideApprovalCard } from "./device-config-override-approval-card";
import type { DeviceConfigOverride } from "@/lib/device-config-override-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const definitionsState = vi.hoisted(() => ({
  data: null as ConfigFieldDefinition[] | null,
  isLoading: true,
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({
    data: definitionsState.data,
    isLoading: definitionsState.isLoading,
    error: null,
    refetch: vi.fn(),
  }),
}));

function makeFieldDef(
  overrides: Partial<ConfigFieldDefinition>,
): ConfigFieldDefinition {
  return {
    id: "def-1",
    fieldName: "FIELD",
    dataType: "string",
    allowedValues: [],
    required: false,
    unknownSpec: false,
    description: null,
    unit: null,
    stOverridable: false,
    category: null,
    sensitive: false,
    restartRequired: false,
    defaultValue: null,
    supportedModels: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const item: DeviceConfigOverride = {
  id: "ov-1",
  deviceId: "DTC-0001",
  configId: "cfg-1",
  versionNumber: 1,
  fields: { COMMAND_PASSWORD: "s3cr3t", SERVER_PORT: 8080 },
  reason: "ลูกค้าขอเปลี่ยนค่าหน้างาน",
  status: "pending",
  overriddenBy: "user-st-1",
  overriddenAt: "2026-01-01T00:00:00Z",
  decidedBy: null,
  decidedAt: null,
  rejectReason: null,
};

describe("DeviceConfigOverrideApprovalCard — mask ค่า sensitive ใน Approval Center", () => {
  it("field ที่ ConfigFieldDefinition.sensitive === true ไม่ render plaintext", () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "COMMAND_PASSWORD", sensitive: true }),
      makeFieldDef({ fieldName: "SERVER_PORT", sensitive: false }),
    ];
    definitionsState.isLoading = false;

    render(
      <DeviceConfigOverrideApprovalCard
        item={item}
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
  });

  it("useConfigDefinitions() ยังโหลดไม่เสร็จ -> ไม่ leak plaintext ของ field ไหนเลย", () => {
    definitionsState.data = null;
    definitionsState.isLoading = true;

    render(
      <DeviceConfigOverrideApprovalCard
        item={item}
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.queryByText("8080")).not.toBeInTheDocument();
  });

  it("แสดง deviceId/reason/ผู้ส่งคำขอ", () => {
    definitionsState.data = [];
    definitionsState.isLoading = false;

    render(
      <DeviceConfigOverrideApprovalCard
        item={item}
        canDecide={true}
        onDecided={vi.fn()}
      />,
    );

    expect(screen.getByText("DTC-0001")).toBeInTheDocument();
    expect(screen.getByText("ลูกค้าขอเปลี่ยนค่าหน้างาน")).toBeInTheDocument();
    expect(screen.getByText("user-st-1")).toBeInTheDocument();
  });

  it("canDecide=false -> ไม่เห็นปุ่มอนุมัติ/ปฏิเสธ", () => {
    definitionsState.data = [];
    definitionsState.isLoading = false;

    render(
      <DeviceConfigOverrideApprovalCard
        item={item}
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
});
