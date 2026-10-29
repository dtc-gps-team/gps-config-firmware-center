import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CampaignRolloutCreateForm } from "./campaign-rollout-create-form";
import type { Config } from "@/lib/config-api";
import type { Device } from "@/lib/device-api";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const createCampaignRollout = vi.fn();
vi.mock("@/lib/campaign-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/campaign-api")>(
      "@/lib/campaign-api",
    );
  return {
    ...actual,
    createCampaignRollout: (...args: unknown[]) =>
      createCampaignRollout(...args),
  };
});

function queryState<T>(data: T) {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

const members = [
  { deviceId: "DEV-0001" },
  { deviceId: "DEV-0002" },
  { deviceId: "DEV-0003" },
];

function makeDevice(
  deviceId: string,
  deviceModel: string,
  protocol = "TCP",
): Device {
  return {
    id: `id-${deviceId}`,
    deviceId,
    simNumber: "0800000000",
    deviceModel,
    protocol,
    hardwareRevisionCode: null,
    imei: null,
    serialNumber: null,
    blackboxId: null,
    bootloader: null,
    status: "installed",
    registeredAt: "2026-01-01T00:00:00Z",
    installedAt: null,
    customer: null,
  };
}

const devices: Device[] = [
  makeDevice("DEV-0001", "GT06N"),
  makeDevice("DEV-0002", "GT06N"),
  makeDevice("DEV-0003", "VT300"),
];

const gt06nConfig: Config = {
  id: "cfg-gt06n",
  name: "GT06N มาตรฐาน",
  deviceModel: "GT06N",
  protocol: "TCP",
  description: null,
  status: "approved",
  fields: {},
  createdBy: "u1",
  approvedBy: "u2",
  suggestedApproverId: null,
  clonedFromId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const hookState = vi.hoisted(() => ({
  targets: [] as { deviceId: string }[],
  devices: [] as unknown[],
  configs: [] as unknown[],
}));

vi.mock("@/hooks/use-campaign-targets", () => ({
  useCampaignTargets: () => queryState(hookState.targets),
}));
vi.mock("@/hooks/use-devices", () => ({
  useDevices: () => queryState(hookState.devices),
}));
vi.mock("@/hooks/use-configs", () => ({
  useConfigs: () => queryState(hookState.configs),
}));
vi.mock("@/hooks/use-firmware", () => ({
  useFirmwareList: () => queryState([]),
}));

async function selectConfig(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  await user.click(screen.getByRole("combobox", { name: "Config" }));
  await user.click(await screen.findByRole("option", { name }));
}

async function next(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /ถัดไป/ }));
}

function checkboxFor(deviceId: string) {
  const row = screen.getByText(deviceId).closest("tr");
  if (!row) throw new Error(`ไม่เจอแถวของ ${deviceId}`);
  return row.querySelector<HTMLElement>('[role="checkbox"]')!;
}

/**
 * Rollout wizard 4 ขั้น: เป้าหมาย → เวอร์ชัน/Config → ตรวจสอบผลกระทบ → ยืนยัน
 * (แถว 5 จากรีวิวพี่เลี้ยง 12 ต.ค.: เครื่องที่ไม่เข้ากันกับ payload ถูกข้ามพร้อมเหตุผล
 * และไม่ทำให้ submit โดน 409)
 */
describe("CampaignRolloutCreateForm: wizard 4 ขั้น", () => {
  beforeEach(() => {
    createCampaignRollout.mockReset();
    push.mockReset();
    hookState.targets = members;
    hookState.devices = devices;
    hookState.configs = [gt06nConfig];
  });

  it("เริ่มที่ขั้นเป้าหมาย: ทุกเครื่องถูกเลือก และยังไม่เห็นตัวเลือก Config", () => {
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    for (const id of ["DEV-0001", "DEV-0002", "DEV-0003"]) {
      expect(checkboxFor(id)).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.queryByRole("combobox", { name: "Config" })).not.toBeInTheDocument();
  });

  it("ยังไม่เลือก Config: ไปขั้นตรวจสอบผลกระทบไม่ได้ และบอกให้เลือก", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await next(user);

    expect(await screen.findByText("เลือก Config ก่อน")).toBeInTheDocument();
  });

  it("ขั้นตรวจสอบ: เครื่องคนละโมเดลถูกข้ามพร้อมเหตุผล", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);

    expect(
      screen.getByText(/โมเดล VT300 ไม่ตรงกับ Config นี้ \(ต้องเป็น GT06N\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("DEV-0003")).toBeInTheDocument();
  });

  it("ขั้นยืนยัน: สรุปจำนวนที่จะได้รับ", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await next(user);

    expect(screen.getByText("2 จาก 3 เครื่อง")).toBeInTheDocument();
  });

  it("กดเริ่ม Rollout: ส่งเครื่องที่ไม่เข้ากันไปใน excludeDeviceIds ให้เอง", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await next(user);
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    expect(createCampaignRollout).toHaveBeenCalledWith("tok", "camp-1", {
      payloadType: "Config",
      configId: "cfg-gt06n",
      excludeDeviceIds: ["DEV-0003"],
    });
  });

  it("เอาเครื่องที่เข้ากันออกเองด้วย: excludeDeviceIds รวมทั้งสองกลุ่ม ไม่ซ้ำ", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await user.click(checkboxFor("DEV-0002"));
    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await next(user);
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    const body = createCampaignRollout.mock.calls[0][2] as {
      excludeDeviceIds: string[];
    };
    expect([...body.excludeDeviceIds].sort()).toEqual(["DEV-0002", "DEV-0003"]);
  });

  it("ไม่มีเครื่องไหนเข้ากันเลย: ไม่ไปขั้นยืนยัน ไม่ยิง API และบอกให้เลือก payload อื่น", async () => {
    hookState.targets = [{ deviceId: "DEV-0003" }];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await next(user);

    expect(createCampaignRollout).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/ไม่มีเครื่องไหนในกลุ่มที่เข้ากัน/),
    ).toBeInTheDocument();
  });
});
