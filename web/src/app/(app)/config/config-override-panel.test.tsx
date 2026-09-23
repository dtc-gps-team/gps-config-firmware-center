import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ConfigOverridePanel } from "./config-override-panel";
import type { Config } from "@/lib/config-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("@/components/auth/auth-provider", () => ({
  // role ST — canOverrideConfig(role) ต้องเป็น true ถึงจะ render panel นี้เลย
  useAuth: () => ({ session: { accessToken: "tok", role: "ST" } }),
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

const baseConfig: Config = {
  id: "c1",
  name: "Test Config",
  deviceModel: "GT06N",
  protocol: "TCP",
  description: null,
  status: "approved",
  fields: { COMMAND_PASSWORD: "s3cr3t", SERVER_PORT: 8080 },
  createdBy: "user-1",
  approvedBy: "op-1",
  suggestedApproverId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("ConfigOverridePanel — race condition ตอน useConfigDefinitions() ยังโหลดไม่เสร็จ", () => {
  it("ไม่ render field เป็น plaintext ระหว่างโหลด (แสดง loading state แทน ไม่ default เป็น \"ไม่ sensitive/ไม่ overridable\")", () => {
    definitionsState.data = null;
    definitionsState.isLoading = true;

    render(<ConfigOverridePanel config={baseConfig} onOverridden={vi.fn()} />);

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.queryByText("8080")).not.toBeInTheDocument();
    expect(screen.getByText(/กำลังโหลด/)).toBeInTheDocument();
  });

  it("หลังโหลดเสร็จ field sensitive ที่ override ไม่ได้ (read-only) ยัง mask อยู่ ไม่ leak plaintext", () => {
    definitionsState.data = [
      makeFieldDef({
        fieldName: "COMMAND_PASSWORD",
        sensitive: true,
        stOverridable: false,
      }),
      makeFieldDef({
        fieldName: "SERVER_PORT",
        sensitive: false,
        stOverridable: false,
        dataType: "number",
      }),
    ];
    definitionsState.isLoading = false;

    render(<ConfigOverridePanel config={baseConfig} onOverridden={vi.fn()} />);

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
  });
});
