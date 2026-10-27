import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ConfigDetailView } from "./config-detail-view";
import type { Config } from "@/lib/config-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  // role Operation: canUpdateConfig false — ตัด ConfigReviewPanel ออกจากการ
  // render กันชนกับ field list ที่ทดสอบอยู่ (ConfigOverridePanel ถูกลบไปแล้ว
  // — issue #223, แก้ครั้งที่ 55)
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const configState = vi.hoisted(() => ({
  data: null as Config | null,
  isLoading: false,
}));
vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({
    data: configState.data,
    isLoading: configState.isLoading,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-config-versions", () => ({
  useConfigVersions: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({
    resolveName: (id: string) =>
      ({ "user-1": "Config Engineer Tester", "op-1": "Operation Tester" })[
        id
      ] ?? id,
    isLoading: false,
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
  clonedFromId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("ConfigDetailView — mask ค่า sensitive", () => {
  beforeEach(() => {
    configState.data = baseConfig;
    configState.isLoading = false;
  });

  it("field ที่ definitions บอกว่า sensitive ไม่ leak plaintext เมื่อโหลดเสร็จแล้ว", () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "COMMAND_PASSWORD", sensitive: true }),
      makeFieldDef({ fieldName: "SERVER_PORT", sensitive: false }),
    ];
    definitionsState.isLoading = false;

    render(<ConfigDetailView configId="c1" />);

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
  });

  it("race condition — config โหลดเสร็จก่อน แต่ useConfigDefinitions() ยังโหลดไม่เสร็จ: ไม่ leak plaintext ของ field ไหนเลย (ไม่ default เป็น \"ไม่ sensitive\")", () => {
    definitionsState.data = null;
    definitionsState.isLoading = true;

    render(<ConfigDetailView configId="c1" />);

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.queryByText("8080")).not.toBeInTheDocument();
  });

  it("field sensitive ที่ค่าเป็น null โชว์ — ไม่ใช่ mask ที่กดดูได้ (ไม่มีอะไรให้ดูจริง)", () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "COMMAND_PASSWORD", sensitive: true }),
    ];
    definitionsState.isLoading = false;
    configState.data = {
      ...baseConfig,
      fields: { COMMAND_PASSWORD: null },
    };

    render(<ConfigDetailView configId="c1" />);

    expect(
      screen.queryByRole("button", { name: "แสดงค่า" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});

describe("ConfigDetailView — JSON ที่คัดลอกได้เป็น 'settings' ซ้อนชั้น (รีวิวพี่เลี้ยง 27 ต.ค. — ต้องตรงกับ JSON ที่ Server กลางรับจริง)", () => {
  beforeEach(() => {
    configState.data = baseConfig;
    configState.isLoading = false;
  });

  it("key แบบมีจุด -> JSON ที่โชว์/คัดลอกซ้อนชั้นเป็น settings ไม่ใช่ fields แบน", () => {
    configState.data = {
      ...baseConfig,
      fields: { "gps.enabled": true, "gps.send_interval_sec": 10 },
    };
    definitionsState.data = [];
    definitionsState.isLoading = false;

    const { container } = render(<ConfigDetailView configId="c1" />);

    const json = container.querySelector("pre code")?.textContent ?? "";
    const parsed = JSON.parse(json);
    expect(parsed.settings).toEqual({
      gps: { enabled: true, send_interval_sec: 10 },
    });
    expect(parsed.fields).toBeUndefined();
  });

  it("รุ่นที่ key ไม่มีจุด (เช่น GT06N) -> settings แบนเหมือนเดิม (no-op)", () => {
    configState.data = {
      ...baseConfig,
      fields: { APN1: "internet", MTYP: "1" },
    };
    definitionsState.data = [];
    definitionsState.isLoading = false;

    const { container } = render(<ConfigDetailView configId="c1" />);

    const json = container.querySelector("pre code")?.textContent ?? "";
    expect(JSON.parse(json).settings).toEqual({
      APN1: "internet",
      MTYP: "1",
    });
  });
});

describe("ConfigDetailView — แก้ UUID ดิบที่ 'สร้างโดย'/'ผู้อนุมัติ' (พบจาก UX/UI audit)", () => {
  beforeEach(() => {
    configState.data = baseConfig;
    configState.isLoading = false;
    definitionsState.data = [];
    definitionsState.isLoading = false;
  });

  it("โชว์ชื่อที่ resolve แล้ว ไม่ใช่ userId ดิบ", () => {
    render(<ConfigDetailView configId="c1" />);

    expect(screen.getByText("Config Engineer Tester")).toBeInTheDocument();
    expect(screen.getByText("Operation Tester")).toBeInTheDocument();
    expect(screen.queryByText("user-1")).not.toBeInTheDocument();
    expect(screen.queryByText("op-1")).not.toBeInTheDocument();
  });

  it("approvedBy เป็น null (ยังไม่อนุมัติ) -> โชว์ \"-\" ไม่เรียก resolveName", () => {
    configState.data = { ...baseConfig, approvedBy: null };

    render(<ConfigDetailView configId="c1" />);

    expect(screen.getByText("Config Engineer Tester")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });
});
