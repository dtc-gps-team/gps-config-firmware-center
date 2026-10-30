import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { IncidentDetailView } from "./incident-detail-view";
import type { Incident } from "@/lib/incident-api";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const auth = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: auth.role } }),
}));

const hook = vi.hoisted(() => ({
  value: {} as {
    data: unknown;
    isLoading: boolean;
    error: string | null;
    refetch: () => void;
  },
}));
vi.mock("@/hooks/use-incident", () => ({ useIncident: () => hook.value }));

vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({
    resolveName: (id: string) =>
      ({ "user-st": "ช่างสมศรี", "op-1": "คุณปฏิบัติการ" })[id] ?? id,
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

function setHook(partial: Partial<typeof hook.value>) {
  hook.value = {
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...partial,
  };
}

describe("IncidentDetailView", () => {
  beforeEach(() => {
    auth.role = "Operation";
    router.push.mockReset();
    setHook({});
  });

  it("กำลังโหลดครั้งแรก: แสดงโครงรอ ยังไม่แสดงเนื้อหา", () => {
    setHook({ isLoading: true });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(screen.queryByText("ที่มา")).not.toBeInTheDocument();
  });

  it("ไม่พบหรือโหลดไม่สำเร็จ: แสดงข้อความ ปุ่มลองใหม่ และลิงก์กลับรายการ", () => {
    setHook({ error: "ไม่พบรายงานปัญหา" });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(screen.getByText("ไม่พบรายงานปัญหา")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "กลับไปรายการ" })).toHaveAttribute(
      "href",
      "/incidents",
    );
  });

  it("Field Report: แสดงรายละเอียด ที่มา อุปกรณ์ (ลิงก์) และชื่อผู้แจ้ง ไม่ใช่ UUID", () => {
    setHook({ data: incident() });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(
      screen.getByText("ทดสอบกด 3 ครั้ง ไม่มีแจ้งเตือน"),
    ).toBeInTheDocument();
    expect(screen.getByText("แจ้งจากหน้างาน")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "DEV-0103" })).toHaveAttribute(
      "href",
      "/devices/DEV-0103",
    );
    expect(screen.getByText("ช่างสมศรี")).toBeInTheDocument();
    expect(screen.queryByText("user-st")).not.toBeInTheDocument();
  });

  it("Operation เห็นปุ่มตัดสินใจบน Field Report ที่ยัง open", () => {
    setHook({ data: incident() });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(
      screen.getByRole("button", { name: "ตัดสินใจ" }),
    ).toBeInTheDocument();
  });

  it("role อื่นเห็นแบบดูอย่างเดียว ไม่มีปุ่มตัดสินใจ", () => {
    auth.role = "Auditor";
    setHook({ data: incident() });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(
      screen.queryByRole("button", { name: "ตัดสินใจ" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("ดูได้อย่างเดียว")).toBeInTheDocument();
  });

  it("ตัดสินใจแล้ว: แสดงในไทม์ไลน์ (ชื่อผู้ตัดสินใจ + หมายเหตุ) และไม่มีปุ่ม", () => {
    setHook({
      data: incident({
        status: "dismissed",
        reviewedBy: "op-1",
        reviewedAt: "2026-10-12T10:00:00Z",
        reviewNote: "ซ้ำกับรายการเดิม",
      }),
    });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(screen.getByText(/^ตัดสินใจ:/)).toBeInTheDocument();
    expect(screen.getByText("โดย คุณปฏิบัติการ")).toBeInTheDocument();
    expect(screen.getByText("ซ้ำกับรายการเดิม")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ตัดสินใจ" }),
    ).not.toBeInTheDocument();
  });

  it("ยังไม่ตัดสินใจ: ไม่มีเหตุการณ์ตัดสินใจในไทม์ไลน์", () => {
    setHook({ data: incident() });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(screen.queryByText(/^ตัดสินใจ:/)).not.toBeInTheDocument();
  });

  it("ตรวจพบอัตโนมัติ: ลิงก์ Config/Firmware และรายละเอียดทางเทคนิค (ครั้งที่พยายาม + error)", () => {
    setHook({
      data: incident({
        source: "config-sync-writer",
        deviceId: null,
        reportedBy: null,
        relatedConfigId: "cfg-9",
        relatedFirmwareId: "fw-3",
        metadata: {
          versionNumber: 3,
          attempts: 3,
          lastError: "connection timeout",
        },
      }),
    });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(screen.getByText("ตรวจพบอัตโนมัติ")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /ดูรายละเอียด Config/ }),
    ).toHaveAttribute("href", "/config/cfg-9");
    expect(
      screen.getByRole("link", { name: /ดูรายละเอียด Firmware/ }),
    ).toHaveAttribute("href", "/firmware/fw-3");
    expect(screen.getByText("3 ครั้ง")).toBeInTheDocument();
    expect(screen.getByText("connection timeout")).toBeInTheDocument();
    expect(screen.queryByText("ผู้แจ้ง")).not.toBeInTheDocument();
  });

  it("source ที่ไม่รู้จัก: ไม่แสดงแถวที่มา (ไม่เดาคำอธิบาย)", () => {
    setHook({ data: incident({ source: "something-new" }) });

    render(<IncidentDetailView incidentId="inc-1" />);

    expect(screen.queryByText("ที่มา")).not.toBeInTheDocument();
  });
});
