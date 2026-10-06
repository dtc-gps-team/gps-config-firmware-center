import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfigWizard } from "./config-wizard";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "ConfigEngineer" } }),
}));

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

const createConfig = vi.fn();
vi.mock("@/lib/config-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config-api")>(
    "@/lib/config-api",
  );
  return {
    ...actual,
    createConfig: (...args: unknown[]) => createConfig(...args),
    updateConfig: vi.fn(),
  };
});

function makeFieldDef(
  overrides: Partial<ConfigFieldDefinition>,
): ConfigFieldDefinition {
  return {
    id: overrides.fieldName ?? "def-1",
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
    ...overrides,
  };
}

/** ข้าม step 1 (ชื่อ/รุ่น/โปรโตคอล) ไป step 2 (กรอกค่า field) — กรอกชื่อ +
 * เลือกรุ่น/โปรโตคอลผ่าน native <select> (shadcn Select render เป็น
 * combobox ของ Radix ซึ่งทดสอบด้วย userEvent.click ตรงๆ ได้) */
async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ชื่อ Config"), "Test Config");

  await user.click(screen.getByRole("combobox", { name: "รุ่นอุปกรณ์" }));
  await user.click(await screen.findByRole("option", { name: "GT06N" }));

  await user.click(screen.getByRole("combobox", { name: "โปรโตคอล" }));
  await user.click(await screen.findByRole("option", { name: "TCP" }));

  await user.click(screen.getByRole("button", { name: /ถัดไป/ }));
}

describe("ConfigWizard — json/array dataType (แก้ตามรีวิว B PR #255 ข้อ 2, รอบ 2)", () => {
  beforeEach(() => {
    createConfig.mockReset();
    routerPush.mockReset();
    createConfig.mockResolvedValue({ id: "c1", name: "Test Config" });
  });

  it("json field กรอก object ที่ถูกต้อง -> submit ผ่าน ส่ง object จริง (ไม่ใช่ string)", async () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "JSON_FIELD", dataType: "json" }),
    ];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);

    await user.click(screen.getByRole("button", { name: /JSON_FIELD/ }));
    fireEvent.change(document.getElementById("field-JSON_FIELD")!, {
      target: { value: '{"a":1}' },
    });
    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));

    await waitFor(() => expect(createConfig).toHaveBeenCalled());
    expect(createConfig.mock.calls[0][1].fields).toEqual({
      JSON_FIELD: { a: 1 },
    });
  });

  it("json field กรอกเป็น JSON array -> block submit (json ต้องเป็น object ไม่ใช่ array)", async () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "JSON_FIELD", dataType: "json" }),
    ];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);

    await user.click(screen.getByRole("button", { name: /JSON_FIELD/ }));
    fireEvent.change(document.getElementById("field-JSON_FIELD")!, {
      target: { value: "[1,2,3]" },
    });
    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));

    expect(
      await screen.findByText(/ไม่ใช่ JSON ที่ถูกต้องตามชนิดข้อมูล/),
    ).toBeInTheDocument();
    expect(createConfig).not.toHaveBeenCalled();
  });

  it("array field กรอก JSON array ที่ถูกต้อง -> submit ผ่าน ส่ง array จริง", async () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "ARRAY_FIELD", dataType: "array" }),
    ];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);

    await user.click(screen.getByRole("button", { name: /ARRAY_FIELD/ }));
    fireEvent.change(document.getElementById("field-ARRAY_FIELD")!, {
      target: { value: "[1,2,3]" },
    });
    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));

    await waitFor(() => expect(createConfig).toHaveBeenCalled());
    expect(createConfig.mock.calls[0][1].fields).toEqual({
      ARRAY_FIELD: [1, 2, 3],
    });
  });

  it("json field กรอก string ที่ parse JSON ไม่ขึ้น -> block submit พร้อมบอกชื่อ field", async () => {
    definitionsState.data = [
      makeFieldDef({ fieldName: "JSON_FIELD", dataType: "json" }),
    ];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);

    await user.click(screen.getByRole("button", { name: /JSON_FIELD/ }));
    await user.type(document.getElementById("field-JSON_FIELD")!, "not-json");
    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));

    expect(await screen.findByText(/JSON_FIELD \(json\)/)).toBeInTheDocument();
    expect(createConfig).not.toHaveBeenCalled();
  });
});
