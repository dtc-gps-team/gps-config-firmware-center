import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IncidentsView } from "./incidents-view";
import type { Incident } from "@/lib/incident-api";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const auth = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: auth.role } }),
}));

const incidentsState = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/hooks/use-incidents", () => ({
  useIncidents: () => ({
    data: incidentsState.rows,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({
    resolveName: (id: string) => (id === "user-st" ? "ช่างสมศรี" : id),
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    title: "ปุ่ม SOS กดแล้วไม่ส่งแจ้งเตือน",
    description: "ทดสอบกด 3 ครั้ง ไม่มีแจ้งเตือน",
    severity: "critical",
    status: "open",
    relatedConfigId: null,
    relatedFirmwareId: null,
    source: "field-report",
    metadata: null,
    deviceId: "DEV-0103",
    reportedBy: "user-st",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
    ...overrides,
  };
}

describe("IncidentsView: Field Report", () => {
  beforeEach(() => {
    auth.role = "Operation";
    router.push.mockReset();
  });

  it("Field Report แสดงอุปกรณ์และชื่อช่างผู้แจ้ง (ไม่ใช่ UUID)", () => {
    incidentsState.rows = [incident()];

    render(<IncidentsView />);

    // ประเภท + ผลกระทบ (อุปกรณ์) + ผู้แจ้ง แยกคนละช่อง
    expect(screen.getByText("แจ้งจากหน้างาน")).toBeInTheDocument();
    expect(screen.getByText("อุปกรณ์ DEV-0103")).toBeInTheDocument();
    expect(screen.getByText(/ช่างสมศรี/)).toBeInTheDocument();
    expect(screen.queryByText(/user-st/)).not.toBeInTheDocument();
  });

  it("ชื่อเรื่องเป็นลิงก์ไปหน้ารายละเอียด Incident", () => {
    incidentsState.rows = [incident({ id: "inc-7" })];

    render(<IncidentsView />);

    expect(
      screen.getByRole("link", { name: "ปุ่ม SOS กดแล้วไม่ส่งแจ้งเตือน" }),
    ).toHaveAttribute("href", "/incidents/inc-7");
  });

  it("Operation เห็นปุ่มตัดสินใจบน Field Report ที่ยัง open", () => {
    incidentsState.rows = [incident()];

    render(<IncidentsView />);

    expect(
      screen.getByRole("button", { name: "ตัดสินใจ" }),
    ).toBeInTheDocument();
  });

  it("ตัดสินใจไปแล้ว: ไม่มีปุ่ม แสดงหมายเหตุของ Operation และป้ายสถานะ 'ไม่ต้องดำเนินการ'", async () => {
    incidentsState.rows = [
      incident({
        status: "dismissed",
        reviewedBy: "op-1",
        reviewNote: "ซ้ำกับรายการเดิม",
      }),
    ];

    render(<IncidentsView />);
    // Incident ที่ปิดแล้วอยู่ในแท็บ "ปิดแล้ว" ไม่อยู่ในแท็บเริ่มต้น กดแท็บก่อนถึงจะเห็นแถวนี้
    await userEvent.click(screen.getByRole("button", { name: /^ปิดแล้ว\s*\d+$/ }));

    expect(
      screen.queryByRole("button", { name: "ตัดสินใจ" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/ซ้ำกับรายการเดิม/)).toBeInTheDocument();
    // ป้ายสถานะในแถว (ตัวกรองสถานะเป็น dropdown ปิดอยู่จึงไม่ซ้ำ)
    expect(screen.getByText("ไม่ต้องดำเนินการ")).toBeInTheDocument();
  });

  it("Incident ที่ไม่ใช่ Field Report (สร้างอัตโนมัติ): Operation ไม่เห็นปุ่มตัดสินใจ แต่ปิดได้ด้วยปุ่ม 'ปิด Incident'", () => {
    incidentsState.rows = [
      incident({
        source: "config-sync-writer",
        deviceId: null,
        reportedBy: null,
      }),
    ];

    render(<IncidentsView />);

    expect(
      screen.queryByRole("button", { name: "ตัดสินใจ" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ปิด Incident" }),
    ).toBeInTheDocument();
  });

  it("Role อื่นที่ไม่ใช่ Operation: ไม่เห็นปุ่มตัดสินใจ", () => {
    auth.role = "ST";
    incidentsState.rows = [incident()];

    render(<IncidentsView />);

    expect(
      screen.queryByRole("button", { name: "ตัดสินใจ" }),
    ).not.toBeInTheDocument();
  });
});

function rolloutIncident(overrides: Partial<Incident> = {}): Incident {
  return incident({
    id: "inc-r1",
    title: "Rollout หยุดอัตโนมัติ: อัปเดต GT06N",
    description: null,
    severity: "high",
    source: "rollout-failure",
    deviceId: null,
    reportedBy: null,
    metadata: {
      kind: "auto-pause",
      failureCount: 20,
      targetCount: 100,
      skippedCount: 5,
    },
    ...overrides,
  });
}

describe("IncidentsView: แยกที่มาและผลกระทบ", () => {
  beforeEach(() => {
    auth.role = "Operation";
    router.push.mockReset();
  });

  it("Incident จาก Rollout: แสดงประเภท ชนิดย่อย และจำนวนเครื่องที่ได้รับผลกระทบ", () => {
    incidentsState.rows = [rolloutIncident()];

    render(<IncidentsView />);

    expect(screen.getByText("Rollout ล้มเหลว")).toBeInTheDocument();
    expect(screen.getByText("หยุดอัตโนมัติ")).toBeInTheDocument();
    expect(
      screen.getByText("ล้มเหลว 20 จาก 100 เครื่อง (20%)"),
    ).toBeInTheDocument();
    expect(screen.getByText("ข้ามเพราะออฟไลน์ 5 เครื่อง")).toBeInTheDocument();
    // แถบสัดส่วนล้มเหลว/ถูกข้ามแสดงเฉพาะ Incident จาก Rollout
    expect(
      screen.getByRole("img", { name: /สัดส่วนเครื่องที่ล้มเหลว/ }),
    ).toBeInTheDocument();
  });

  it("Incident จากการเขียน Config: แสดงประเภท และไม่มีส่วนผลกระทบ (ไม่มีจำนวนเครื่อง)", () => {
    incidentsState.rows = [
      incident({
        source: "config-sync-writer",
        deviceId: null,
        reportedBy: null,
        metadata: { attempts: 3 },
      }),
    ];

    render(<IncidentsView />);

    expect(screen.getByText("เขียน Config ไม่สำเร็จ")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /สัดส่วนเครื่องที่ล้มเหลว/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/จาก .* เครื่อง/)).not.toBeInTheDocument();
  });

  it("source ที่ไม่รู้จัก: แสดงเป็น 'อื่นๆ' ไม่หายจากรายการ", () => {
    incidentsState.rows = [incident({ source: null, deviceId: null })];

    render(<IncidentsView />);

    expect(screen.getByText("อื่นๆ")).toBeInTheDocument();
  });

  it("กรองตามประเภท: เหลือเฉพาะ Incident ของประเภทที่เลือก", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [
      incident({ id: "inc-f", title: "ปัญหาจากช่าง" }),
      rolloutIncident({ title: "ปัญหาจาก Rollout" }),
    ];

    render(<IncidentsView />);
    expect(screen.getByText("ปัญหาจากช่าง")).toBeInTheDocument();
    expect(screen.getByText("ปัญหาจาก Rollout")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /ประเภท/ }));
    await user.click(
      await screen.findByRole("option", { name: "Rollout ล้มเหลว" }),
    );

    expect(screen.queryByText("ปัญหาจากช่าง")).not.toBeInTheDocument();
    expect(screen.getByText("ปัญหาจาก Rollout")).toBeInTheDocument();
  });

  it("กรองตามความรุนแรง: เหลือเฉพาะระดับที่เลือก", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [
      incident({ id: "inc-c", title: "รุนแรงมาก", severity: "critical" }),
      rolloutIncident({ title: "รุนแรงสูง", severity: "high" }),
    ];

    render(<IncidentsView />);

    await user.click(screen.getByRole("combobox", { name: /ความรุนแรง/ }));
    await user.click(await screen.findByRole("option", { name: "high" }));

    expect(screen.queryByText("รุนแรงมาก")).not.toBeInTheDocument();
    expect(screen.getByText("รุนแรงสูง")).toBeInTheDocument();
  });

  it("กรองแล้วไม่เหลือรายการ: ขึ้นข้อความไม่พบที่ตรงกับเงื่อนไข", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [incident({ severity: "critical" })];

    render(<IncidentsView />);

    await user.click(screen.getByRole("combobox", { name: /ความรุนแรง/ }));
    await user.click(await screen.findByRole("option", { name: "low" }));

    expect(
      screen.getByText("ไม่พบ Incident ที่ตรงกับเงื่อนไข"),
    ).toBeInTheDocument();
  });

  it("จำนวนในหัวการ์ดนับเฉพาะรายการที่ผ่านตัวกรอง", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [
      incident({ id: "a", severity: "critical" }),
      incident({ id: "b", severity: "critical" }),
      rolloutIncident({ severity: "high" }),
    ];

    render(<IncidentsView />);
    const heading = screen.getByText(/^รายการ Incident/);
    expect(within(heading).getByText("(3)")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /ความรุนแรง/ }));
    await user.click(await screen.findByRole("option", { name: "high" }));

    expect(within(heading).getByText("(1)")).toBeInTheDocument();
  });
});
describe("IncidentsView: แท็บ ยังไม่ปิด / ปิดแล้ว / ทั้งหมด", () => {
  beforeEach(() => {
    auth.role = "Operation";
    router.push.mockReset();
  });

  const open = () => incident({ id: "o", title: "ยังเปิดอยู่", status: "open" });
  const investigating = () =>
    incident({ id: "i", title: "กำลังตรวจสอบ", status: "investigating" });
  const resolved = () =>
    incident({ id: "r", title: "แก้แล้ว", status: "resolved" });
  const dismissed = () =>
    incident({ id: "d", title: "ไม่ต้องดำเนินการแล้ว", status: "dismissed" });
  const rolledBack = () =>
    incident({ id: "b", title: "ย้อนกลับแล้ว", status: "rolled_back" });

  const tab = (name: RegExp) => screen.getByRole("button", { name });
  const openTab = /^ยังไม่ปิด\s*\d+$/;
  const closedTab = /^ปิดแล้ว\s*\d+$/;
  const allTab = /^ทั้งหมด\s*\d+$/;

  it("ค่าเริ่มต้นคือแท็บ 'ยังไม่ปิด': เห็นเฉพาะ open และ investigating", () => {
    incidentsState.rows = [
      open(),
      investigating(),
      resolved(),
      dismissed(),
      rolledBack(),
    ];

    render(<IncidentsView />);

    expect(tab(openTab)).toHaveAttribute("aria-pressed", "true");
    expect(tab(closedTab)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("ยังเปิดอยู่")).toBeInTheDocument();
    expect(screen.getByText("กำลังตรวจสอบ")).toBeInTheDocument();
    expect(screen.queryByText("แก้แล้ว")).not.toBeInTheDocument();
    expect(screen.queryByText("ไม่ต้องดำเนินการแล้ว")).not.toBeInTheDocument();
    expect(screen.queryByText("ย้อนกลับแล้ว")).not.toBeInTheDocument();
  });

  it("แต่ละแท็บมีจำนวนกำกับ", () => {
    incidentsState.rows = [
      open(),
      investigating(),
      resolved(),
      dismissed(),
      rolledBack(),
    ];

    render(<IncidentsView />);

    expect(screen.getByRole("button", { name: "ยังไม่ปิด 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดแล้ว 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ทั้งหมด 5" })).toBeInTheDocument();
  });

  it("กดแท็บ 'ปิดแล้ว': เห็นเฉพาะที่ปิดแล้ว ไม่เห็นที่ยังเปิดอยู่ และไม่มีหัวกลุ่ม", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [open(), investigating(), resolved(), dismissed()];

    render(<IncidentsView />);
    await user.click(tab(closedTab));

    expect(tab(closedTab)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("แก้แล้ว")).toBeInTheDocument();
    expect(screen.getByText("ไม่ต้องดำเนินการแล้ว")).toBeInTheDocument();
    expect(screen.queryByText("ยังเปิดอยู่")).not.toBeInTheDocument();
    expect(screen.queryByText("กำลังตรวจสอบ")).not.toBeInTheDocument();
    expect(screen.queryByText(/^ยังไม่ปิด \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^ปิดแล้ว \(/)).not.toBeInTheDocument();
  });

  it("กดแท็บ 'ทั้งหมด': เห็นครบ ยังไม่ปิดอยู่ก่อนแม้ที่ปิดแล้วจะใหม่กว่า พร้อมหัวกลุ่มและจำนวน", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [
      incident({ id: "c1", title: "ปิดแล้วใหม่สุด", status: "dismissed" }),
      incident({ id: "o1", title: "ยังเปิดเก่ากว่า", status: "open" }),
      incident({ id: "c2", title: "ปิดแล้วเก่า", status: "resolved" }),
    ];

    render(<IncidentsView />);
    await user.click(tab(allTab));

    expect(screen.getByText("ยังไม่ปิด (1)")).toBeInTheDocument();
    expect(screen.getByText("ปิดแล้ว (2)")).toBeInTheDocument();
    const titles = screen
      .getAllByRole("link", {
        name: /ปิดแล้วใหม่สุด|ยังเปิดเก่ากว่า|ปิดแล้วเก่า/,
      })
      .map((a) => a.textContent);
    expect(titles).toEqual(["ยังเปิดเก่ากว่า", "ปิดแล้วใหม่สุด", "ปิดแล้วเก่า"]);
  });

  it("'ทั้งหมด' ที่มีแต่ที่ปิดแล้ว: ไม่มีหัวกลุ่ม ไม่ต้องแยก", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [resolved()];

    render(<IncidentsView />);
    await user.click(tab(allTab));

    expect(screen.queryByText(/^ปิดแล้ว \(/)).not.toBeInTheDocument();
  });

  it("จำนวนในหัวการ์ดตามแท็บที่เลือก", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [open(), resolved(), dismissed()];

    render(<IncidentsView />);
    const heading = screen.getByText(/^รายการ Incident/);
    expect(within(heading).getByText("(1)")).toBeInTheDocument();

    await user.click(tab(closedTab));
    expect(within(heading).getByText("(2)")).toBeInTheDocument();

    await user.click(tab(allTab));
    expect(within(heading).getByText("(3)")).toBeInTheDocument();
  });

  it("ปิดทั้งหมดแล้ว: แท็บ 'ยังไม่ปิด' บอกว่าไม่มีที่ยังไม่ปิด ไม่ใช่ 'ยังไม่มี Incident'", () => {
    incidentsState.rows = [resolved(), dismissed()];

    render(<IncidentsView />);

    expect(screen.getByText("ไม่มี Incident ที่ยังไม่ปิด")).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มี Incident")).not.toBeInTheDocument();
  });

  it("ยังเปิดอยู่ทั้งหมด: แท็บ 'ปิดแล้ว' บอกว่ายังไม่มีที่ปิดแล้ว", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [open(), investigating()];

    render(<IncidentsView />);
    await user.click(tab(closedTab));

    expect(screen.getByText("ยังไม่มี Incident ที่ปิดแล้ว")).toBeInTheDocument();
  });

  it("ไม่มี Incident เลย: ขึ้น 'ยังไม่มี Incident'", () => {
    incidentsState.rows = [];

    render(<IncidentsView />);

    expect(screen.getByText("ยังไม่มี Incident")).toBeInTheDocument();
  });

  it("เลือกสถานะเจาะจงในตัวกรอง: แสดงสถานะนั้นตรงๆ และแท็บปิดไว้", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [resolved()];

    render(<IncidentsView />);
    expect(screen.queryByText("แก้แล้ว")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /สถานะ/ }));
    await user.click(await screen.findByRole("option", { name: "Resolved" }));

    expect(screen.getByText("แก้แล้ว")).toBeInTheDocument();
    expect(tab(openTab)).toBeDisabled();
    expect(tab(closedTab)).toBeDisabled();
    expect(tab(allTab)).toBeDisabled();
  });

  it("ตัวกรองประเภท/ความรุนแรงมีผลกับจำนวนบนแท็บด้วย", async () => {
    const user = userEvent.setup();
    incidentsState.rows = [
      incident({ id: "a", status: "open", severity: "critical" }),
      incident({ id: "b", status: "open", severity: "low" }),
      incident({ id: "c", status: "resolved", severity: "low" }),
    ];

    render(<IncidentsView />);
    await user.click(screen.getByRole("combobox", { name: /ความรุนแรง/ }));
    await user.click(await screen.findByRole("option", { name: "low" }));

    expect(screen.getByRole("button", { name: "ยังไม่ปิด 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดแล้ว 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ทั้งหมด 2" })).toBeInTheDocument();
  });
});
