import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CampaignCreateForm } from "./campaign-create-form";
import type { Device } from "@/lib/device-api";
import type { Incident } from "@/lib/incident-api";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

vi.mock("@/hooks/use-unsaved-changes-warning", () => ({
  useUnsavedChangesWarning: () => ({ confirmLeave: () => true }),
}));

const createCampaign = vi.fn();
vi.mock("@/lib/campaign-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/campaign-api")>(
      "@/lib/campaign-api",
    );
  return {
    ...actual,
    createCampaign: (...args: unknown[]) => createCampaign(...args),
  };
});

const devicesState = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/hooks/use-devices", () => ({
  useDevices: () => ({
    data: devicesState.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const incidentState = vi.hoisted(() => ({
  data: null as unknown,
  isLoading: false,
  error: null as string | null,
}));
vi.mock("@/hooks/use-incident", () => ({
  useIncident: (id: string | null) =>
    id === null ? { data: null, isLoading: false, error: null } : incidentState,
}));

function device(deviceId: string, status: Device["status"] = "installed") {
  return {
    id: `id-${deviceId}`,
    deviceId,
    simNumber: "0800000000",
    deviceModel: "GT06N",
    protocol: "TCP",
    hardwareRevisionCode: null,
    imei: null,
    serialNumber: null,
    blackboxId: null,
    status,
    registeredAt: "2026-01-01T00:00:00Z",
    installedAt: null,
    customer: null,
  } satisfies Device;
}

function sourceIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    title: "เครื่องรีบูตเองทุก 10 นาที",
    description: null,
    severity: "high",
    status: "investigating",
    relatedConfigId: null,
    relatedFirmwareId: null,
    source: "field-report",
    metadata: null,
    deviceId: "DEV-0124",
    reportedBy: "user-ot",
    reviewedBy: "op-1",
    reviewedAt: "2026-10-12T09:00:00Z",
    reviewNote: "ต้องอัปเดต Firmware",
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T09:00:00Z",
    ...overrides,
  };
}

describe("CampaignCreateForm: มาจาก ส่งต่อเป็น Campaign", () => {
  beforeEach(() => {
    createCampaign.mockReset();
    createCampaign.mockResolvedValue({ id: "c1", name: "x" });
    router.push.mockReset();
    devicesState.data = [device("DEV-0124"), device("DEV-0125")];
    incidentState.data = sourceIncident();
    incidentState.isLoading = false;
    incidentState.error = null;
  });

  it("ตั้งชื่อเริ่มต้นจากหัวข้อ Incident และเลือกอุปกรณ์ที่รายงานไว้ให้", () => {
    render(<CampaignCreateForm sourceIncidentId="inc-1" />);

    expect(screen.getByLabelText("ชื่อกลุ่ม")).toHaveValue(
      "แก้ไขปัญหา: เครื่องรีบูตเองทุก 10 นาที",
    );
    expect(screen.getByText(/เลือกแล้ว 1/)).toBeInTheDocument();
    expect(
      screen.getByText(/เลือกอุปกรณ์ที่รายงานไว้ให้แล้ว/),
    ).toBeInTheDocument();
  });

  it("สร้างสำเร็จ: ส่ง sourceIncidentId และอุปกรณ์ที่เลือกไปกับคำขอ", async () => {
    const user = userEvent.setup();
    render(<CampaignCreateForm sourceIncidentId="inc-1" />);

    await user.click(screen.getByRole("button", { name: "สร้างกลุ่ม" }));

    await waitFor(() => expect(createCampaign).toHaveBeenCalledTimes(1));
    expect(createCampaign).toHaveBeenCalledWith("tok", {
      name: "แก้ไขปัญหา: เครื่องรีบูตเองทุก 10 นาที",
      targets: [{ deviceId: "DEV-0124" }],
      sourceIncidentId: "inc-1",
    });
  });

  it("แก้ชื่อได้อิสระ ไม่ถูกค่าเริ่มต้นทับ", async () => {
    const user = userEvent.setup();
    render(<CampaignCreateForm sourceIncidentId="inc-1" />);
    const name = screen.getByLabelText("ชื่อกลุ่ม");

    await user.clear(name);
    await user.type(name, "อัปเดต Firmware GT08");

    expect(name).toHaveValue("อัปเดต Firmware GT08");
  });

  it("อุปกรณ์ที่รายงานยังไม่ติดตั้ง: ไม่เลือกให้ และบอกเหตุผล", async () => {
    devicesState.data = [device("DEV-0124", "registered"), device("DEV-0125")];

    render(<CampaignCreateForm sourceIncidentId="inc-1" />);

    expect(screen.getByText(/เลือกแล้ว 0/)).toBeInTheDocument();
    expect(
      screen.getByText(/ยังไม่ติดตั้ง จึงเลือกให้ไม่ได้/),
    ).toBeInTheDocument();
  });

  it("โหลด Incident ไม่สำเร็จ: เตือน ไม่ส่ง sourceIncidentId แต่ยังสร้างกลุ่มตามปกติได้", async () => {
    incidentState.data = null;
    incidentState.error = "ไม่พบ Incident";
    const user = userEvent.setup();
    render(<CampaignCreateForm sourceIncidentId="inc-1" />);

    expect(screen.getByText(/ไม่ถูกผูกกับรายงานปัญหา/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("ชื่อกลุ่ม"), "กลุ่มทดสอบ");
    await user.click(screen.getByText("DEV-0125"));
    await user.click(screen.getByRole("button", { name: "สร้างกลุ่ม" }));

    await waitFor(() => expect(createCampaign).toHaveBeenCalled());
    expect(createCampaign.mock.calls[0][1]).not.toHaveProperty(
      "sourceIncidentId",
    );
  });

  it("Incident ไม่ได้อยู่ในสถานะ investigating แล้ว: เตือน และไม่ส่ง sourceIncidentId", async () => {
    incidentState.data = sourceIncident({ status: "resolved" });
    const user = userEvent.setup();
    render(<CampaignCreateForm sourceIncidentId="inc-1" />);

    expect(
      screen.getByText(/ไม่ได้อยู่ในสถานะที่ส่งต่อเป็น/),
    ).toBeInTheDocument();
    // ไม่ตั้งชื่อ/เลือกเครื่องให้ เพราะไม่ได้ผูกกับรายงานนี้
    expect(screen.getByLabelText("ชื่อกลุ่ม")).toHaveValue("");
    await user.type(screen.getByLabelText("ชื่อกลุ่ม"), "กลุ่ม");
    await user.click(screen.getByText("DEV-0125"));
    await user.click(screen.getByRole("button", { name: "สร้างกลุ่ม" }));

    await waitFor(() => expect(createCampaign).toHaveBeenCalled());
    expect(createCampaign.mock.calls[0][1]).not.toHaveProperty(
      "sourceIncidentId",
    );
  });

  it("ไม่ได้มาจาก flow นี้: ฟอร์มเหมือนเดิม ไม่มีแถบที่มา ไม่มีค่าเริ่มต้น", () => {
    render(<CampaignCreateForm />);

    expect(screen.getByLabelText("ชื่อกลุ่ม")).toHaveValue("");
    expect(screen.getByText(/เลือกแล้ว 0/)).toBeInTheDocument();
    expect(screen.queryByText(/สร้างจากรายงานปัญหา/)).not.toBeInTheDocument();
  });
});
