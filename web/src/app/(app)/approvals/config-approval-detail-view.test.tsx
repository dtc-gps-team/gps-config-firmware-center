import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfigApprovalDetailView } from "./config-approval-detail-view";
import type { Config, ConfigVersion } from "@/lib/config-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const auth = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: auth.role } }),
}));

const api = vi.hoisted(() => ({ approveConfig: vi.fn() }));
vi.mock("@/lib/config-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config-api")>()),
  approveConfig: api.approveConfig,
}));

const state = vi.hoisted(() => ({
  config: null as unknown,
  versions: null as unknown,
  definitions: null as unknown,
  // ต้นฉบับของสำเนา (clonedFromId) — id ที่ตรงกับ sourceId ได้ข้อมูลชุดนี้
  sourceId: null as string | null,
  source: null as unknown,
  sourceError: null as string | null,
  sourceVersions: null as unknown,
}));
vi.mock("@/hooks/use-config", () => ({
  useConfig: (id: string | null) =>
    id !== null && id === state.sourceId
      ? {
          data: state.source,
          isLoading: false,
          error: state.sourceError,
          refetch: vi.fn(),
        }
      : {
          data: state.config,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        },
}));
vi.mock("@/hooks/use-config-versions", () => ({
  useConfigVersions: (id: string | null) =>
    id !== null && id === state.sourceId
      ? {
          data: state.sourceVersions,
          isLoading: state.sourceVersions === null,
          error: null,
          refetch: vi.fn(),
        }
      : {
          data: state.versions,
          isLoading: state.versions === null,
          error: null,
          refetch: vi.fn(),
        },
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({
    data: state.definitions,
    isLoading: state.definitions === null,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({
    resolveName: (id: string) => (id === "user-1" ? "สมชาย ใจดี" : id),
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

function def(
  fieldName: string,
  overrides: Partial<ConfigFieldDefinition> = {},
): ConfigFieldDefinition {
  return {
    id: `def-${fieldName}`,
    fieldName,
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
    minValue: null,
    maxValue: null,
    supportedModels: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function version(
  versionNumber: number,
  fields: Record<string, unknown>,
): ConfigVersion {
  return {
    id: `v${versionNumber}`,
    configId: "cfg-1",
    versionNumber,
    deviceModel: "GT06N",
    protocol: "TCP",
    fields,
    approvedBy: "op-1",
    approvedAt: "2026-01-01T00:00:00Z",
  };
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    id: "cfg-1",
    name: "Test Config",
    deviceModel: "GT06N",
    protocol: "TCP",
    description: null,
    status: "testing",
    fields: {
      SERVER_PORT: 9000,
      APN: "internet",
      COMMAND_PASSWORD: "s3cr3t",
      REPORT_INTERVAL: 30,
    },
    createdBy: "user-1",
    approvedBy: null,
    suggestedApproverId: null,
    clonedFromId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

const definitions = [
  def("SERVER_PORT", { category: "Server" }),
  def("APN", { category: "Network" }),
  def("COMMAND_PASSWORD", { category: "Security", sensitive: true }),
  def("REPORT_INTERVAL", { category: "Server", restartRequired: true }),
];

function setup(opts: {
  config?: Config;
  versions?: ConfigVersion[] | null;
  definitions?: ConfigFieldDefinition[] | null;
  source?: Config | null;
  sourceError?: string | null;
  sourceVersions?: ConfigVersion[] | null;
}) {
  const cfg = opts.config ?? config();
  state.sourceId = cfg.clonedFromId;
  state.source = opts.source ?? null;
  state.sourceError = opts.sourceError ?? null;
  state.sourceVersions =
    opts.sourceVersions === undefined ? [] : opts.sourceVersions;
  state.config = cfg;
  state.versions = opts.versions === undefined ? [] : opts.versions;
  state.definitions =
    opts.definitions === undefined ? definitions : opts.definitions;
  return render(<ConfigApprovalDetailView configId="cfg-1" />);
}

describe("ConfigApprovalDetailView", () => {
  beforeEach(() => {
    auth.role = "Operation";
    router.push.mockReset();
    api.approveConfig.mockReset();
  });

  // ลิงก์กลับ Approval Center ย้ายไปอยู่ใน breadcrumb ของแถบบนแล้ว (UI ปรับใหม่
  // 2026-10) — breadcrumb ทดสอบแยกที่ components/page-header.test.tsx
  it("ส่วนหัว: ชื่อผู้สร้างแทน UUID, โมเดล, โปรโตคอล", () => {
    setup({});

    expect(
      screen.getByRole("heading", { level: 1, name: "Test Config" }),
    ).toBeInTheDocument();
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.queryByText("user-1")).not.toBeInTheDocument();
    expect(screen.getByText("GT06N")).toBeInTheDocument();
  });

  it("เคยอนุมัติแล้ว: สรุปจำนวน เพิ่ม/แก้ไข/ลบ เทียบเวอร์ชันล่าสุด และบอกว่าอนุมัติแล้วจะเป็นเวอร์ชันถัดไป", () => {
    setup({
      versions: [
        version(1, { SERVER_PORT: 1 }),
        // ตั้งใจใส่เวอร์ชันที่ใหม่กว่าไว้ท้ายสุด ต้องเลือกตามเลขเวอร์ชัน
        version(3, { SERVER_PORT: 8080, APN: "internet", OLD: true }),
      ],
    });

    expect(
      screen.getByText(/เทียบกับเวอร์ชันที่ 3 อนุมัติแล้วจะเป็นเวอร์ชันที่ 4/),
    ).toBeInTheDocument();
    expect(screen.getByText("เพิ่ม 2")).toBeInTheDocument(); // COMMAND_PASSWORD, REPORT_INTERVAL
    expect(screen.getByText("แก้ไข 1")).toBeInTheDocument(); // SERVER_PORT
    expect(screen.getByText("ลบ 1")).toBeInTheDocument(); // OLD
    expect(screen.getByText("ไม่เปลี่ยน 1")).toBeInTheDocument(); // APN
  });

  it("ค่าที่เปลี่ยนแสดงค่าเดิมเทียบค่าใหม่", () => {
    setup({ versions: [version(1, { SERVER_PORT: 8080 })] });

    expect(screen.getByText("8080")).toBeInTheDocument();
    // 9000 อยู่ทั้งในตารางที่เปลี่ยนและในรายการค่าทั้งหมด
    expect(screen.getAllByText("9000").length).toBeGreaterThanOrEqual(1);
  });

  it("ค่า sensitive ถูกซ่อนทั้งในตารางที่เปลี่ยนและรายการทั้งหมด ไม่ leak plaintext", () => {
    setup({ versions: [version(1, { COMMAND_PASSWORD: "old-secret" })] });

    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.queryByText("old-secret")).not.toBeInTheDocument();
    expect(screen.getAllByText("••••••••").length).toBeGreaterThanOrEqual(2);
  });

  it("definitions ยังโหลดไม่เสร็จ: ซ่อนทุกค่าไว้ก่อน (กัน plaintext หลุดช่วงสั้นๆ)", () => {
    setup({ definitions: null, versions: [version(1, { APN: "old" })] });

    expect(screen.queryByText("internet")).not.toBeInTheDocument();
    expect(screen.queryByText("9000")).not.toBeInTheDocument();
    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
  });

  it("field ที่เปลี่ยนและเป็น sensitive/ต้อง restart ขึ้นก่อน field ธรรมดา", () => {
    setup({ versions: [version(1, { SERVER_PORT: 1, APN: "x" })] });

    const summary = screen
      .getByText("สิ่งที่เปลี่ยนจากเวอร์ชันที่อนุมัติล่าสุด")
      .closest("[data-slot=card]") as HTMLElement;
    const text = summary.textContent ?? "";
    // ธรรมดา: APN, SERVER_PORT · ต้องระวัง: COMMAND_PASSWORD, REPORT_INTERVAL
    expect(text.indexOf("COMMAND_PASSWORD")).toBeLessThan(text.indexOf("APN"));
    expect(text.indexOf("REPORT_INTERVAL")).toBeLessThan(
      text.indexOf("SERVER_PORT"),
    );
  });

  it("ยังไม่เคยอนุมัติ: บอกว่าไม่มีเวอร์ชันให้เทียบ ไม่ใช่ตารางว่างเปล่า", () => {
    setup({ versions: [] });

    expect(
      screen.getByText(/ยังไม่เคยถูกอนุมัติ จึงไม่มีเวอร์ชันให้เทียบ/),
    ).toBeInTheDocument();
  });

  it("ค่าไม่ต่างจากเวอร์ชันล่าสุดเลย: บอกว่าเหมือนเดิม", () => {
    setup({ versions: [version(2, config().fields)] });

    expect(
      screen.getByText("ค่าทุกตัวเหมือนเวอร์ชันที่อนุมัติล่าสุด"),
    ).toBeInTheDocument();
  });

  it("ค่าทั้งหมดจัดกลุ่มตามหมวดของ field และ field ที่ไม่มีหมวดอยู่กลุ่ม 'อื่นๆ' ท้ายสุด", () => {
    setup({
      config: config({ fields: { SERVER_PORT: 1, APN: "a", MYSTERY: 2 } }),
    });

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Network (1)", "Server (1)", "อื่นๆ (1)"]);
  });

  it("ค้นหาชื่อ field กรองรายการทั้งหมด", async () => {
    const user = userEvent.setup();
    setup({});

    await user.type(screen.getByLabelText("ค้นหาชื่อ field"), "apn");

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Network (1)"]);
  });

  it("ติ๊ก 'แสดงเฉพาะที่เปลี่ยน': รายการทั้งหมดเหลือแต่ field ที่เปลี่ยน", async () => {
    const user = userEvent.setup();
    setup({
      versions: [
        version(1, {
          SERVER_PORT: 1,
          APN: "internet",
          COMMAND_PASSWORD: "s3cr3t",
          REPORT_INTERVAL: 30,
        }),
      ],
    });

    await user.click(screen.getByLabelText("แสดงเฉพาะที่เปลี่ยน"));

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Server (1)"]); // เหลือ SERVER_PORT ตัวเดียว
  });

  it("Operation: มีปุ่มอนุมัติ/ปฏิเสธ และอนุมัติสำเร็จแล้วกลับไปหน้าคิว", async () => {
    api.approveConfig.mockResolvedValue({});
    const user = userEvent.setup();
    setup({});

    expect(screen.getByRole("button", { name: "ปฏิเสธ" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันอนุมัติ" }));

    expect(api.approveConfig).toHaveBeenCalledWith("tok", "cfg-1");
    expect(router.push).toHaveBeenCalledWith("/approvals");
  });

  it("Role ที่ไม่ใช่ Operation: ไม่มีปุ่มอนุมัติ/ปฏิเสธ มีข้อความอธิบายแทน", () => {
    auth.role = "ConfigEngineer";
    setup({});

    expect(
      screen.queryByRole("button", { name: "อนุมัติ" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/เฉพาะ Operation เท่านั้นที่อนุมัติ/),
    ).toBeInTheDocument();
  });

  it("Config ไม่อยู่ในคิวแล้ว (เช่น approved): แจ้งเตือน และไม่มีปุ่มตัดสินใจ", () => {
    setup({ config: config({ status: "approved" }) });

    expect(screen.getByText(/ไม่อยู่ในคิวรออนุมัติแล้ว/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "อนุมัติ" }),
    ).not.toBeInTheDocument();
  });

  it("ไม่มีปุ่มตัดสินใจโผล่ในส่วนอื่นนอกส่วนหัว (กันซ้ำซ้อน)", () => {
    setup({});

    expect(screen.getAllByRole("button", { name: "อนุมัติ" })).toHaveLength(1);
    const details = within(document.body);
    expect(details.getAllByRole("button", { name: "ทดสอบซ้ำ" })).toHaveLength(
      1,
    );
  });
});

describe("ConfigApprovalDetailView: สำเนาที่ยังไม่เคยอนุมัติ เทียบกับต้นฉบับ", () => {
  const cloned = () => config({ clonedFromId: "src-1" });
  const sourceConfig = (overrides: Partial<Config> = {}) =>
    config({
      id: "src-1",
      name: "Source Config",
      status: "approved",
      fields: { SERVER_PORT: 9000 },
      ...overrides,
    });

  beforeEach(() => {
    auth.role = "Operation";
    router.push.mockReset();
  });

  it("เทียบกับเวอร์ชันที่อนุมัติล่าสุดของต้นฉบับ (ไม่ใช่ค่าปัจจุบัน) และบอกชื่อต้นฉบับ", () => {
    setup({
      config: cloned(),
      versions: [],
      source: sourceConfig({ fields: { SERVER_PORT: 1, APN: "draft-edit" } }),
      sourceVersions: [
        version(1, { SERVER_PORT: 1 }),
        version(2, { SERVER_PORT: 8080, APN: "internet" }),
      ],
    });

    expect(
      screen.getByText("สิ่งที่ต่างจาก Config ต้นฉบับ: Source Config"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/เทียบกับเวอร์ชันที่ 2 ของต้นฉบับ/),
    ).toBeInTheDocument();
    // ต้นฉบับ v2 = { SERVER_PORT: 8080, APN } เทียบกับสำเนา { 9000, internet, ... }
    expect(screen.getByText("แก้ไข 1")).toBeInTheDocument(); // SERVER_PORT
    expect(screen.getByText("ไม่เปลี่ยน 1")).toBeInTheDocument(); // APN
  });

  it("ส่วนหัวมีลิงก์ 'โคลนจาก' ไปหน้าต้นฉบับ", () => {
    setup({
      config: cloned(),
      source: sourceConfig(),
      sourceVersions: [version(1, { SERVER_PORT: 1 })],
    });

    expect(screen.getByText("โคลนจาก")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Source Config" }),
    ).toHaveAttribute("href", "/config/src-1");
  });

  it("ต้นฉบับยังไม่เคยอนุมัติ: เทียบกับค่าปัจจุบันของต้นฉบับและบอกให้เห็น", () => {
    setup({
      config: cloned(),
      source: sourceConfig({ status: "draft", fields: { SERVER_PORT: 1 } }),
      sourceVersions: [],
    });

    expect(
      screen.getByText(/ต้นฉบับยังไม่เคยอนุมัติ จึงเทียบกับค่าปัจจุบันของต้นฉบับ/),
    ).toBeInTheDocument();
  });

  it("ต้นฉบับเปิดไม่ได้: บอกว่าเทียบไม่ได้ ไม่ error ทั้งหน้า และปุ่มอนุมัติยังอยู่", () => {
    setup({
      config: cloned(),
      source: null,
      sourceError: "ไม่พบ Config",
    });

    expect(
      screen.getByText(/ไม่พบ Config ต้นฉบับหรือโหลดไม่สำเร็จ จึงเทียบไม่ได้/),
    ).toBeInTheDocument();
    expect(screen.getByText(/เปิดไม่ได้ อาจถูกลบแล้ว/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /อนุมัติ/ })).toBeInTheDocument();
  });

  it("ต้นฉบับต่างโมเดล: แสดงคำเตือนว่าค่าที่ไม่มีจะขึ้นเป็น ลบ", () => {
    setup({
      config: cloned(),
      source: sourceConfig({ deviceModel: "GT06L" }),
      sourceVersions: [version(1, { SERVER_PORT: 1 })],
    });

    expect(
      screen.getByText(/ต้นฉบับเป็น GT06L \/ TCP ต่างจาก Config นี้/),
    ).toBeInTheDocument();
  });

  it("เคยอนุมัติแล้ว: ใช้เวอร์ชันของตัวเองก่อน แม้เป็นสำเนา", () => {
    setup({
      config: cloned(),
      versions: [version(4, { SERVER_PORT: 8080 })],
      source: sourceConfig(),
      sourceVersions: [version(1, { SERVER_PORT: 1 })],
    });

    expect(
      screen.getByText("สิ่งที่เปลี่ยนจากเวอร์ชันที่อนุมัติล่าสุด"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/เทียบกับเวอร์ชันที่ 4 อนุมัติแล้วจะเป็นเวอร์ชันที่ 5/),
    ).toBeInTheDocument();
  });

  it("ไม่ใช่สำเนา: ไม่มีแถว 'โคลนจาก'", () => {
    setup({});

    expect(screen.queryByText("โคลนจาก")).not.toBeInTheDocument();
  });
});

describe("ConfigApprovalDetailView: ตารางความต่างแบบคอลัมน์", () => {
  beforeEach(() => {
    auth.role = "Operation";
    router.push.mockReset();
  });

  it("มีหัวคอลัมน์ ชื่อฟิลด์ / เวอร์ชันฐาน / Config นี้ / ประเภท", () => {
    setup({ versions: [version(3, { SERVER_PORT: 8080 })] });

    expect(screen.getByText("ชื่อฟิลด์")).toBeInTheDocument();
    expect(screen.getByText("เวอร์ชันที่ 3")).toBeInTheDocument();
    expect(screen.getByText("Config นี้")).toBeInTheDocument();
    expect(screen.getByText("ประเภท")).toBeInTheDocument();
  });

  it("สำเนา: หัวคอลัมน์ฐานบอกว่าเป็นเวอร์ชันของต้นฉบับ", () => {
    setup({
      config: config({ clonedFromId: "src-1" }),
      versions: [],
      source: config({
        id: "src-1",
        name: "Source Config",
        status: "approved",
        fields: { SERVER_PORT: 1 },
      }),
      sourceVersions: [version(2, { SERVER_PORT: 1 })],
    });

    expect(screen.getByText("ต้นฉบับ (เวอร์ชันที่ 2)")).toBeInTheDocument();
  });

  it("ค่าที่เพิ่ม: ฝั่งค่าเดิมเป็น - และมีป้ายประเภท เพิ่ม ค่าที่ลบ: ฝั่งค่าใหม่เป็น - และมีป้าย ลบ", () => {
    setup({
      versions: [version(1, { OLD_ONLY: true, APN: "internet" })],
    });

    // SERVER_PORT/COMMAND_PASSWORD/REPORT_INTERVAL เพิ่ม · OLD_ONLY ลบ
    expect(screen.getAllByText("เพิ่ม").length).toBe(3);
    expect(screen.getByText("ลบ")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(4);
  });
});
