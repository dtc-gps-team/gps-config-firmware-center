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

// ทะเบียนโมเดล (`GET /device-models`) — โปรโตคอลที่เลือกได้ในหน้า step 1 ล็อก
// ตาม `supportedProtocols` ของรุ่นในทะเบียน (เหมือนหน้าลงทะเบียนอุปกรณ์)
const registryState = vi.hoisted(() => ({
  data: [] as { name: string; supportedProtocols: string[] }[],
}));
vi.mock("@/hooks/use-device-models", () => ({
  useDeviceModels: () => ({
    data: registryState.data,
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
 * เลือกรุ่น (โปรโตคอลถูกเลือกให้ตามทะเบียน) ผ่าน native <select> (shadcn Select render เป็น
 * combobox ของ Radix ซึ่งทดสอบด้วย userEvent.click ตรงๆ ได้) */
async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ชื่อ Config"), "Test Config");

  await user.click(screen.getByRole("combobox", { name: "โมเดล" }));
  await user.click(await screen.findByRole("option", { name: "GT06N" }));

  // GT06N ในทะเบียนรองรับ TCP อย่างเดียว: โปรโตคอลถูกเลือกให้และล็อกช่องไว้
  expect(screen.getByRole("combobox", { name: "โปรโตคอล" })).toHaveTextContent(
    "TCP",
  );

  await user.click(screen.getByRole("button", { name: /ถัดไป/ }));
}

beforeEach(() => {
  registryState.data = [{ name: "GT06N", supportedProtocols: ["TCP"] }];
});

describe("ConfigWizard — โหมดโคลนบันทึกต้นทาง (clonedFromId)", () => {
  const source = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "GT06N มาตรฐาน",
    deviceModel: "GT06N",
    protocol: "TCP",
    description: null,
    status: "approved" as const,
    fields: { APN1: "internet" },
    createdBy: "u1",
    approvedBy: "op1",
    suggestedApproverId: null,
    clonedFromId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  beforeEach(() => {
    createConfig.mockReset();
    routerPush.mockReset();
    createConfig.mockResolvedValue({ id: "c2", name: "GT06N มาตรฐาน (สำเนา)" });
    definitionsState.data = [makeFieldDef({ fieldName: "APN1" })];
  });

  it("โคลนจาก Config ต้นทาง: ส่ง clonedFromId เป็น id ของต้นทางตอนบันทึก", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create", cloneFrom: source }} />);

    await user.click(screen.getByRole("button", { name: /ถัดไป/ }));
    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));

    await waitFor(() => expect(createConfig).toHaveBeenCalled());
    expect(createConfig.mock.calls[0][1].clonedFromId).toBe(source.id);
  });

  it("สร้างใหม่ตั้งแต่ต้น (ไม่ได้โคลน): ไม่ส่ง clonedFromId", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);
    await user.click(screen.getByRole("button", { name: /APN1/ }));
    await user.type(document.getElementById("field-APN1")!, "internet");
    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));

    await waitFor(() => expect(createConfig).toHaveBeenCalled());
    expect(createConfig.mock.calls[0][1]).not.toHaveProperty("clonedFromId");
  });
});

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

describe("ConfigWizard: พารามิเตอร์นอกชุดของโมเดล (รีวิวพี่เลี้ยง 12 ต.ค.)", () => {
  const otherModel = [{ deviceModel: "GT06L", protocol: "TCP" }];

  beforeEach(() => {
    createConfig.mockReset();
    routerPush.mockReset();
    createConfig.mockResolvedValue({ id: "c1", name: "Test Config" });
    definitionsState.data = [
      makeFieldDef({ fieldName: "APN1" }),
      makeFieldDef({ fieldName: "EXTRA_PARAM", supportedModels: otherModel }),
      makeFieldDef({
        fieldName: "OTHER_REQUIRED",
        required: true,
        supportedModels: otherModel,
      }),
    ];
  });

  it("ค่าเริ่มต้นแสดงเฉพาะชุดของโมเดล ติ๊กแสดงทั้งหมดแล้วเห็นตัวนอกชุดพร้อมป้าย", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);

    expect(screen.getByRole("button", { name: /APN1/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /EXTRA_PARAM/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: /แสดงพารามิเตอร์ทั้งหมด/ }),
    );

    const extra = screen.getByRole("button", { name: /EXTRA_PARAM/ });
    expect(extra).toHaveTextContent("นอกชุดของโมเดลนี้");
    expect(
      screen.getByRole("button", { name: /APN1/ }),
    ).not.toHaveTextContent("นอกชุดของโมเดลนี้");
  });

  it("field required ของโมเดลอื่นไม่ถูกใส่อัตโนมัติ และเป็น optional เมื่อเพิ่มเข้ามา", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);

    expect(document.getElementById("field-OTHER_REQUIRED")).toBeNull();

    await user.click(
      screen.getByRole("checkbox", { name: /แสดงพารามิเตอร์ทั้งหมด/ }),
    );
    await user.click(screen.getByRole("button", { name: /OTHER_REQUIRED/ }));

    expect(
      screen.getByRole("button", { name: "เอา OTHER_REQUIRED ออก" }),
    ).toBeInTheDocument();
  });

  it("เพิ่มพารามิเตอร์นอกชุดแล้วบันทึก: ส่ง field นั้นไปด้วย", async () => {
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);
    await goToStep2(user);

    await user.click(
      screen.getByRole("checkbox", { name: /แสดงพารามิเตอร์ทั้งหมด/ }),
    );
    await user.click(screen.getByRole("button", { name: /EXTRA_PARAM/ }));
    await user.type(document.getElementById("field-EXTRA_PARAM")!, "x");
    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));

    await waitFor(() => expect(createConfig).toHaveBeenCalled());
    expect(createConfig.mock.calls[0][1].fields).toEqual({ EXTRA_PARAM: "x" });
  });

  it("โคลน Config ที่มีพารามิเตอร์นอกชุดอยู่แล้ว: แสดงใน Template พร้อมป้าย ไม่หายไป", async () => {
    const user = userEvent.setup();
    render(
      <ConfigWizard
        mode={{
          kind: "create",
          cloneFrom: {
            id: "00000000-0000-4000-8000-000000000001",
            name: "มีค่าพิเศษ",
            deviceModel: "GT06N",
            protocol: "TCP",
            description: null,
            status: "approved",
            fields: { APN1: "internet", EXTRA_PARAM: "y" },
            createdBy: "u1",
            approvedBy: "op1",
            suggestedApproverId: null,
            clonedFromId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /ถัดไป/ }));

    expect(document.getElementById("field-EXTRA_PARAM")).toHaveValue("y");
    expect(screen.getAllByText("นอกชุดของโมเดลนี้").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /บันทึก Config Draft/ }));
    await waitFor(() => expect(createConfig).toHaveBeenCalled());
    expect(createConfig.mock.calls[0][1].fields).toEqual({
      APN1: "internet",
      EXTRA_PARAM: "y",
    });
  });
});

describe("ConfigWizard: ล็อกโปรโตคอลตามทะเบียนโมเดล (รีวิวพี่เลี้ยง 19 ต.ค.)", () => {
  beforeEach(() => {
    createConfig.mockReset();
    definitionsState.data = [
      makeFieldDef({
        fieldName: "APN1",
        supportedModels: [
          { deviceModel: "GT06N", protocol: "TCP" },
          { deviceModel: "GT06N", protocol: "UDP" },
        ],
      }),
    ];
  });

  async function pickModel(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ) {
    await user.click(screen.getByRole("combobox", { name: "โมเดล" }));
    await user.click(await screen.findByRole("option", { name }));
  }

  it("โมเดลที่รองรับโปรโตคอลเดียวในทะเบียน: เลือกโปรโตคอลให้อัตโนมัติและล็อกช่อง", async () => {
    registryState.data = [{ name: "GT06N", supportedProtocols: ["TCP"] }];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);

    await pickModel(user, "GT06N");

    const protocolBox = screen.getByRole("combobox", { name: "โปรโตคอล" });
    expect(protocolBox).toHaveTextContent("TCP");
    // โมเดลหนึ่งใช้ได้โปรโตคอลเดียว: ช่องถูกล็อก เปลี่ยนไม่ได้
    expect(protocolBox).toBeDisabled();
  });

  it("โมเดลที่รองรับหลายโปรโตคอล: ไม่เลือกให้ ต้องเลือกเอง และเห็นเฉพาะที่ทะเบียนรองรับ", async () => {
    registryState.data = [
      { name: "GT06N", supportedProtocols: ["TCP", "UDP"] },
    ];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);

    await pickModel(user, "GT06N");

    const protocolBox = screen.getByRole("combobox", { name: "โปรโตคอล" });
    expect(protocolBox).not.toHaveTextContent("TCP");
    expect(protocolBox).not.toHaveTextContent("UDP");

    await user.click(protocolBox);
    expect(await screen.findByRole("option", { name: "TCP" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "UDP" })).toBeInTheDocument();
  });

  it("ทะเบียนรองรับโปรโตคอลที่พารามิเตอร์ยังไม่มี: ยังเลือกได้ตามทะเบียน", async () => {
    registryState.data = [
      { name: "GT06N", supportedProtocols: ["TCP", "HTTP"] },
    ];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);

    await pickModel(user, "GT06N");
    await user.click(screen.getByRole("combobox", { name: "โปรโตคอล" }));

    expect(await screen.findByRole("option", { name: "HTTP" })).toBeInTheDocument();
  });

  it("เปลี่ยนโมเดล: ล้างโปรโตคอลที่เลือกไว้ แล้วเลือกให้ใหม่ถ้าโมเดลใหม่มีโปรโตคอลเดียว", async () => {
    definitionsState.data = [
      makeFieldDef({
        fieldName: "APN1",
        supportedModels: [
          { deviceModel: "GT06N", protocol: "TCP" },
          { deviceModel: "GT06L", protocol: "UDP" },
        ],
      }),
    ];
    registryState.data = [
      { name: "GT06N", supportedProtocols: ["TCP"] },
      { name: "GT06L", supportedProtocols: ["UDP"] },
    ];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);

    await pickModel(user, "GT06N");
    expect(screen.getByRole("combobox", { name: "โปรโตคอล" })).toHaveTextContent(
      "TCP",
    );

    await pickModel(user, "GT06L");
    expect(screen.getByRole("combobox", { name: "โปรโตคอล" })).toHaveTextContent(
      "UDP",
    );
  });

  it("โมเดลที่ยังไม่อยู่ในทะเบียน (ข้อมูลเก่า): ถอยไปใช้โปรโตคอลจากพารามิเตอร์เหมือนเดิม", async () => {
    registryState.data = [];
    const user = userEvent.setup();
    render(<ConfigWizard mode={{ kind: "create" }} />);

    await pickModel(user, "GT06N");
    await user.click(screen.getByRole("combobox", { name: "โปรโตคอล" }));

    expect(await screen.findByRole("option", { name: "TCP" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "UDP" })).toBeInTheDocument();
  });
});
