import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApprovalCard } from "./approval-card";
import type { PendingApproval } from "@/hooks/use-pending-approvals";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

vi.mock("@/hooks/use-config-versions", () => ({
  useConfigVersions: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
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

async function openDetail() {
  const user = userEvent.setup();
  render(<ApprovalCard item={item} canDecide={true} onDecided={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /ดูค่า Config/ }));
}

describe("ApprovalCard — mask ค่า sensitive ใน Approval Center", () => {
  it("field ที่ ConfigFieldDefinition.sensitive === true ไม่ render plaintext — mirror config-detail-view.tsx", async () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "COMMAND_PASSWORD", sensitive: true }),
      makeFieldDef({ fieldName: "SERVER_PORT", sensitive: false }),
    ];
    definitionsState.isLoading = false;

    await openDetail();

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    // field ที่ไม่ sensitive ยังคงโชว์ plaintext ปกติ
    expect(screen.getByText("8080")).toBeInTheDocument();
  });

  it("race condition — useConfigDefinitions() ยังโหลดไม่เสร็จ: ไม่ leak plaintext ของ field ไหนเลย แม้ยังไม่รู้ว่า sensitive จริงไหม", async () => {
    definitionsState.data = null;
    definitionsState.isLoading = true;

    await openDetail();

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.queryByText("8080")).not.toBeInTheDocument();
  });
});
