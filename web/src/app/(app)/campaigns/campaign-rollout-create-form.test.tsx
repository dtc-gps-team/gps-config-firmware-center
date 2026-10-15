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
  valueItems: [] as unknown[],
  definitions: [] as unknown[],
}));

vi.mock("@/hooks/use-rollout-device-values", () => ({
  useRolloutDeviceValues: () => queryState(hookState.valueItems),
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => queryState(hookState.definitions),
}));
vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({
    resolveName: (id: string) => (id === "st-1" ? "ช่างสมศรี" : id),
  }),
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

/** checkbox ของ ui/checkbox เป็น span role=checkbox (ไม่ใช่ <input>) จึงตรวจ
 * สถานะปิดผ่าน aria-disabled ซึ่งเป็นค่าที่โปรแกรมอ่านหน้าจอใช้จริงด้วย */
function expectEnabled(el: HTMLElement) {
  expect(el).not.toHaveAttribute("aria-disabled", "true");
}
function expectDisabled(el: HTMLElement) {
  expect(el).toHaveAttribute("aria-disabled", "true");
}

function checkboxFor(deviceId: string) {
  const row = screen.getByText(deviceId).closest("tr");
  if (!row) throw new Error(`ไม่เจอแถวของ ${deviceId}`);
  return row.querySelector<HTMLElement>('[role="checkbox"]')!;
}

/**
 * แถว 5 จากรีวิวพี่เลี้ยง 12 ต.ค.: เครื่องที่ไม่เข้ากันกับ payload ต้องติ๊ก
 * ไม่ได้ (disabled) แต่ยังโชว์พร้อมเหตุผล และไม่ทำให้ submit โดน 409
 */
describe("CampaignRolloutCreateForm: เครื่องที่ไม่เข้ากันกับ payload", () => {
  beforeEach(() => {
    createCampaignRollout.mockReset();
    push.mockReset();
    hookState.targets = members;
    hookState.devices = devices;
    hookState.configs = [gt06nConfig];
    hookState.valueItems = [];
    hookState.definitions = [];
  });

  it("ยังไม่เลือก Config: ทุกเครื่องติ๊กได้ ไม่มีเหตุผลไม่เข้ากัน", () => {
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    for (const id of ["DEV-0001", "DEV-0002", "DEV-0003"]) {
      expectEnabled(checkboxFor(id));
    }
    expect(screen.queryByText(/ไม่ตรงกับ Config นี้/)).not.toBeInTheDocument();
  });

  it("เลือก Config แล้ว: เครื่องคนละโมเดลถูกปิด checkbox พร้อมเหตุผล และสรุปจำนวนที่จะส่ง", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await selectConfig(user, /GT06N มาตรฐาน/);

    expectEnabled(checkboxFor("DEV-0001"));
    expectEnabled(checkboxFor("DEV-0002"));
    expectDisabled(checkboxFor("DEV-0003"));
    expect(checkboxFor("DEV-0003")).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(/โมเดล VT300 ไม่ตรงกับ Config นี้ \(ต้องเป็น GT06N\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/จะส่งให้ 2 จาก 3/)).toBeInTheDocument();
  });

  it("กดเริ่ม Rollout: ส่งเครื่องที่ไม่เข้ากันไปใน excludeDeviceIds ให้เอง", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await selectConfig(user, /GT06N มาตรฐาน/);
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

    await selectConfig(user, /GT06N มาตรฐาน/);
    await user.click(checkboxFor("DEV-0002"));
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    const body = createCampaignRollout.mock.calls[0][2] as {
      excludeDeviceIds: string[];
    };
    expect([...body.excludeDeviceIds].sort()).toEqual(["DEV-0002", "DEV-0003"]);
  });

  it("ไม่มีเครื่องไหนเข้ากันเลย: ไม่ยิง API และบอกให้เลือก payload อื่น", async () => {
    hookState.targets = [{ deviceId: "DEV-0003" }];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await selectConfig(user, /GT06N มาตรฐาน/);
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    expect(createCampaignRollout).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/ไม่มีเครื่องไหนในกลุ่มที่เข้ากัน/),
    ).toBeInTheDocument();
  });
});

describe("CampaignRolloutCreateForm: ค่าเฉพาะเครื่อง (docs/17)", () => {
  const configWithFields: Config = {
    ...gt06nConfig,
    fields: { SPEED_LIMIT: 120, APN: "internet" },
  };
  const previousFromOtherConfig = {
    deviceId: "DEV-0001",
    hasPendingRequest: false,
    previous: {
      fields: { SPEED_LIMIT: 180 },
      dropped: [{ fieldName: "OLD_FIELD", reason: "ไม่รองรับโมเดลนี้" }],
      fromConfigId: "cfg-old",
      overriddenBy: "st-1",
      overriddenAt: "2026-01-01T00:00:00Z",
      versionNumber: 2,
    },
  };

  beforeEach(() => {
    createCampaignRollout.mockReset();
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    push.mockReset();
    hookState.targets = members;
    hookState.devices = devices;
    hookState.configs = [configWithFields];
    hookState.valueItems = [];
    hookState.definitions = [
      {
        id: "d1",
        fieldName: "SPEED_LIMIT",
        dataType: "integer",
        allowedValues: [],
        sensitive: false,
        unit: null,
      },
    ];
  });

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));
  }

  it("เครื่องที่เคยมีค่าพิเศษจาก Config อื่น: ต้องเลือกก่อนเริ่ม ไม่เลือก = ไม่ยิง API", async () => {
    hookState.valueItems = [previousFromOtherConfig];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await selectConfig(user, /GT06N มาตรฐาน/);

    expect(
      screen.getByText(/เคยมีค่าพิเศษ ตั้งโดย ช่างสมศรี/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ใช้ค่าพิเศษเดิมต่อ: SPEED_LIMIT 180/),
    ).toBeInTheDocument();
    expect(screen.getByText(/OLD_FIELD/)).toBeInTheDocument();

    await submit(user);

    expect(createCampaignRollout).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/เลือกวิธีจัดการค่าพิเศษเดิมให้ครบก่อน/),
    ).toBeInTheDocument();
  });

  it("เลือกใช้ค่าพิเศษเดิมต่อ: ส่ง deviceValues พร้อมเหตุผลที่บังคับกรอก", async () => {
    hookState.valueItems = [previousFromOtherConfig];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await selectConfig(user, /GT06N มาตรฐาน/);

    await user.click(screen.getByLabelText(/ใช้ค่าพิเศษเดิมต่อ/));
    await submit(user);
    expect(createCampaignRollout).not.toHaveBeenCalled();
    expect(
      await screen.findByText("กรอกเหตุผลของค่าเฉพาะเครื่อง", {
        selector: "div p",
      }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/เหตุผลของค่าเฉพาะเครื่อง/),
      "ลูกค้าขอ",
    );
    await submit(user);

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    expect(createCampaignRollout).toHaveBeenCalledWith(
      "tok",
      "camp-1",
      expect.objectContaining({
        deviceValues: [{ deviceId: "DEV-0001", fields: { SPEED_LIMIT: 180 } }],
        deviceValuesReason: "ลูกค้าขอ",
      }),
    );
  });

  it("เลือกใช้ตามแม่แบบใหม่ (ไม่แก้ค่า): ไม่ส่ง deviceValues และไม่ต้องกรอกเหตุผล", async () => {
    hookState.valueItems = [previousFromOtherConfig];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await selectConfig(user, /GT06N มาตรฐาน/);

    await user.click(screen.getByLabelText("ใช้ตามแม่แบบใหม่"));
    await submit(user);

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    const body = createCampaignRollout.mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("deviceValues");
    expect(body).not.toHaveProperty("deviceValuesReason");
  });

  it("แก้ค่าผ่านแผงต่อเครื่อง: แสดง แก้ 1 ค่า และส่งค่าไปพร้อมเหตุผล", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await selectConfig(user, /GT06N มาตรฐาน/);

    await user.click(
      screen.getByRole("button", { name: "แก้ค่าของ DEV-0001" }),
    );
    await user.type(await screen.findByLabelText("SPEED_LIMIT"), "180");
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    expect(await screen.findByText("แก้ 1 ค่า")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(/เหตุผลของค่าเฉพาะเครื่อง/),
      "รถทางไกล",
    );
    await submit(user);

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    expect(createCampaignRollout).toHaveBeenCalledWith(
      "tok",
      "camp-1",
      expect.objectContaining({
        deviceValues: [{ deviceId: "DEV-0001", fields: { SPEED_LIMIT: 180 } }],
      }),
    );
  });

  it("เครื่องที่มีคำขอของช่างค้าง: แสดงข้อความและไม่มีปุ่มแก้ค่า", async () => {
    hookState.valueItems = [
      { deviceId: "DEV-0001", hasPendingRequest: true, previous: null },
    ];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await selectConfig(user, /GT06N มาตรฐาน/);

    expect(screen.getByText(/มีคำขอของช่างรออนุมัติอยู่/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "แก้ค่าของ DEV-0001" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "แก้ค่าของ DEV-0002" }),
    ).toBeInTheDocument();
  });

  it("ค่าพิเศษเดิมผูกกับ Config เดียวกัน: ใช้ต่ออัตโนมัติ ไม่ต้องเลือก", async () => {
    hookState.valueItems = [
      {
        ...previousFromOtherConfig,
        previous: {
          ...previousFromOtherConfig.previous,
          fromConfigId: "cfg-gt06n",
        },
      },
    ];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await selectConfig(user, /GT06N มาตรฐาน/);

    expect(screen.getByText(/ยังมีผลต่อ/)).toBeInTheDocument();
    await submit(user);

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
  });

  it("เอาเครื่องที่มีค่าที่แก้ไว้ออกจาก Rollout: ไม่ส่งค่าของเครื่องนั้น", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await user.click(
      screen.getByRole("button", { name: "แก้ค่าของ DEV-0001" }),
    );
    await user.type(await screen.findByLabelText("SPEED_LIMIT"), "180");
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    await user.click(checkboxFor("DEV-0001"));
    await submit(user);

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    const body = createCampaignRollout.mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("deviceValues");
  });
});
