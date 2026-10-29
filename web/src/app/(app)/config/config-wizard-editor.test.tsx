import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfigWizard } from "./config-wizard";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "ConfigEngineer" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const definitionsState = vi.hoisted(() => ({
  data: null as ConfigFieldDefinition[] | null,
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({
    data: definitionsState.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-device-models", () => ({
  useDeviceModels: () => ({
    data: [{ name: "GT06N", supportedProtocols: ["TCP"] }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/config-api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/config-api")>("@/lib/config-api")),
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

function def(over: Partial<ConfigFieldDefinition>): ConfigFieldDefinition {
  return {
    id: over.fieldName ?? "d",
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
    supportedModels: [{ deviceModel: "GT06N", protocol: "TCP" }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const saved = {
  id: "c1",
  name: "Saved",
  deviceModel: "GT06N",
  protocol: "TCP",
  description: null,
  status: "draft" as const,
  fields: { APN1: "internet", PORT: 8080 },
  createdBy: "u1",
  approvedBy: null,
  suggestedApproverId: null,
  clonedFromId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

async function openStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /ถัดไป/ }));
}

describe("ConfigWizard editor — validation, diff, JSON mode, reset", () => {
  beforeEach(() => {
    definitionsState.data = [
      def({ fieldName: "APN1", category: "Network" }),
      def({ fieldName: "PORT", dataType: "integer", category: "Server", restartRequired: true }),
      def({ fieldName: "EXTRA_JSON", dataType: "json" }),
    ];
  });

  it("จัดกลุ่ม Template ตามหมวด และ field ที่ต้อง Restart มีป้ายกำกับ", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "edit", config: saved }} />);
    await openStep2(user);

    expect(screen.getByRole("region", { name: "Network" })).toBeInTheDocument();
    const server = screen.getByRole("region", { name: "Server" });
    expect(within(server).getByText("ต้อง Restart")).toBeInTheDocument();
  });

  it("ตรวจค่าแบบ real-time: JSON ผิดแสดงข้อความใต้ช่องทันทีและบล็อกการบันทึก", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "edit", config: { ...saved, fields: { EXTRA_JSON: { a: 1 } } } }} />);
    await openStep2(user);

    const input = document.getElementById("field-EXTRA_JSON")!;
    fireEvent.change(input, { target: { value: "{bad" } });

    expect(await screen.findByText("ไม่ใช่ JSON ที่ถูกต้อง")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /บันทึกการแก้ไข/ }));
    expect(screen.getByText(/EXTRA_JSON \(json\)/)).toBeInTheDocument();
  });

  it("โหมดแก้: ไฮไลต์ช่องที่เปลี่ยน แสดงค่าเดิม และ Diff เก่า→ใหม่ก่อนบันทึก", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "edit", config: saved }} />);
    await openStep2(user);

    expect(screen.getByText("ยังไม่มีการเปลี่ยนแปลงจากฉบับเดิม")).toBeInTheDocument();

    fireEvent.change(document.getElementById("field-APN1")!, { target: { value: "m2m" } });

    expect(await screen.findByText("แก้ไขแล้ว")).toBeInTheDocument();
    const diff = screen.getByLabelText("สิ่งที่จะเปลี่ยน");
    expect(within(diff).getByText("แก้ไข 1")).toBeInTheDocument();
    expect(within(diff).getByText("internet")).toBeInTheDocument();
    expect(within(diff).getByText("m2m")).toBeInTheDocument();
  });

  it("โหมด JSON: ซิงก์เข้าฟอร์ม, JSON ผิดบล็อกการบันทึก, field ที่ไม่รู้จักถูกปฏิเสธ", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "edit", config: saved }} />);
    await openStep2(user);

    await user.click(screen.getByRole("button", { name: "JSON" }));
    const textarea = screen.getByLabelText("JSON ของ field และค่า") as HTMLTextAreaElement;
    expect(JSON.parse(textarea.value)).toEqual({ APN1: "internet", PORT: 8080 });

    fireEvent.change(textarea, { target: { value: "{" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("JSON ไม่ถูกต้อง");
    expect(screen.getByRole("button", { name: /บันทึกการแก้ไข/ })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: '{"NOPE": 1}' } });
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่รู้จัก field: NOPE");

    fireEvent.change(textarea, { target: { value: '{"APN1": "m2m", "PORT": 8080}' } });
    expect(screen.getByRole("button", { name: /บันทึกการแก้ไข/ })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "ฟอร์ม" }));
    expect((document.getElementById("field-APN1") as HTMLInputElement).value).toBe("m2m");
  });

  it("โหมด JSON ไม่แสดงค่าอ่อนไหวจริง และคงค่าเดิมไว้ถ้าไม่ได้แก้", async () => {
    definitionsState.data = [
      def({ fieldName: "APN1", category: "Network" }),
      def({ fieldName: "PW", sensitive: true, category: "Security" }),
    ];
    const user = userEvent.setup();
    render(
      <ConfigWizard
        mode={{ kind: "edit", config: { ...saved, fields: { APN1: "internet", PW: "s3cr3t" } } }}
      />,
    );
    await openStep2(user);

    await user.click(screen.getByRole("button", { name: "JSON" }));
    const textarea = screen.getByLabelText("JSON ของ field และค่า") as HTMLTextAreaElement;
    expect(textarea.value).not.toContain("s3cr3t");
    expect(JSON.parse(textarea.value).PW).toBe("********");

    fireEvent.change(textarea, { target: { value: '{"APN1": "m2m", "PW": "********"}' } });
    await user.click(screen.getByRole("button", { name: "ฟอร์ม" }));

    expect((document.getElementById("field-PW") as HTMLInputElement).value).toBe("s3cr3t");
    expect((document.getElementById("field-APN1") as HTMLInputElement).value).toBe("m2m");
  });

  it("รีเซ็ต: ต้องยืนยันก่อน แล้วค่ากลับเป็นฉบับที่บันทึกไว้", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "edit", config: saved }} />);
    await openStep2(user);

    fireEvent.change(document.getElementById("field-APN1")!, { target: { value: "changed" } });
    await user.click(await screen.findByRole("button", { name: /รีเซ็ต/ }));
    expect(await screen.findByText(/การแก้ไขที่ทำไว้จะหายไป/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "รีเซ็ต", hidden: false }));

    expect((document.getElementById("field-APN1") as HTMLInputElement).value).toBe("internet");
  });
});
