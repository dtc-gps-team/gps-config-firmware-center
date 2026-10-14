import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

    expect(screen.getByText(/แจ้งจากหน้างาน/)).toBeInTheDocument();
    expect(screen.getByText("DEV-0103")).toBeInTheDocument();
    expect(screen.getByText(/ช่างสมศรี/)).toBeInTheDocument();
    expect(screen.queryByText(/user-st/)).not.toBeInTheDocument();
  });

  it("Operation เห็นปุ่มตัดสินใจบน Field Report ที่ยัง open", () => {
    incidentsState.rows = [incident()];

    render(<IncidentsView />);

    expect(
      screen.getByRole("button", { name: "ตัดสินใจ" }),
    ).toBeInTheDocument();
  });

  it("ตัดสินใจไปแล้ว: ไม่มีปุ่ม แสดงหมายเหตุของ Operation และป้ายสถานะ 'ไม่ต้องดำเนินการ'", () => {
    incidentsState.rows = [
      incident({
        status: "dismissed",
        reviewedBy: "op-1",
        reviewNote: "ซ้ำกับรายการเดิม",
      }),
    ];

    render(<IncidentsView />);

    expect(
      screen.queryByRole("button", { name: "ตัดสินใจ" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/ซ้ำกับรายการเดิม/)).toBeInTheDocument();
    // ป้ายสถานะในแถว (ตัวกรองสถานะเป็น dropdown ปิดอยู่จึงไม่ซ้ำ)
    expect(screen.getByText("ไม่ต้องดำเนินการ")).toBeInTheDocument();
  });

  it("Incident ที่ไม่ใช่ Field Report (สร้างอัตโนมัติ): ไม่มีปุ่มตัดสินใจแม้เป็น Operation", () => {
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
    expect(screen.getByText("ดูได้อย่างเดียว")).toBeInTheDocument();
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
