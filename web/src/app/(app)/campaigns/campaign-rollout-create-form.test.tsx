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
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const createCampaignRollout = vi.fn();
const updateCampaign = vi.fn();
vi.mock("@/lib/campaign-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/campaign-api")>(
      "@/lib/campaign-api",
    );
  return {
    ...actual,
    createCampaignRollout: (...args: unknown[]) =>
      createCampaignRollout(...args),
    updateCampaign: (...args: unknown[]) => updateCampaign(...args),
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
    modelId: `model-${deviceModel}`,
    deviceModel,
    protocol,
    hardwareRevisionCode: null,
    imei: null,
    serialNumber: null,
    blackboxId: null,
    status: "installed",
    registeredAt: "2026-01-01T00:00:00Z",
    installedAt: null,
    decommissionedAt: null,
    decommissionReason: null,
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
  idMaster: "11111111-1111-4111-8111-111111111111",
  modelId: "model-GT06N",
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
  campaign: { autoRetry: true } as {
    autoRetry: boolean;
    modelId?: string | null;
  } | null,
  campaignError: null as string | null,
}));

vi.mock("@/hooks/use-campaign", () => ({
  useCampaign: () => ({
    ...queryState(hookState.campaign),
    error: hookState.campaignError,
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
    updateCampaign.mockReset();
    updateCampaign.mockResolvedValue({});
    hookState.campaign = { autoRetry: true };
    hookState.campaignError = null;
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
    expect(
      screen.queryByRole("combobox", { name: "Config" }),
    ).not.toBeInTheDocument();
  });

  it("ยังไม่เลือก Config: ไปขั้นตรวจสอบผลกระทบไม่ได้ และบอกให้เลือก", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await next(user);

    expect(await screen.findByText("เลือก Config ก่อน")).toBeInTheDocument();
  });

  it("ขั้นตรวจสอบ: เครื่องคนละโมเดลถูกแสดงพร้อมเหตุผล และกดถัดไปไม่ได้", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);

    expect(
      screen.getByText(/โมเดล VT300 ไม่ตรงกับ Config นี้ \(ต้องเป็น GT06N\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("DEV-0003")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("ไปต่อไม่ได้");
    expect(screen.getByRole("button", { name: /ถัดไป/ })).toBeDisabled();
    expect(createCampaignRollout).not.toHaveBeenCalled();
  });

  it("เอาเครื่องที่ไม่เข้ากันออกจากรอบ: ปลดล็อกถัดไป และสรุปจำนวนที่จะได้รับ", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await user.click(
      screen.getByRole("button", { name: "เอาเครื่องเหล่านี้ออกจากรอบนี้" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await next(user);

    expect(screen.getByText("2 จาก 3 เครื่อง")).toBeInTheDocument();
  });

  it("ขั้นยืนยัน: ระบุรายชื่ออุปกรณ์ที่จะได้รับและที่เอาออกให้ตรวจทาน", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await user.click(
      screen.getByRole("button", { name: "เอาเครื่องเหล่านี้ออกจากรอบนี้" }),
    );
    await next(user);

    expect(screen.getAllByText("อุปกรณ์ที่จะได้รับ").length).toBeGreaterThan(0);
    expect(screen.getByText("DEV-0001")).toBeInTheDocument();
    expect(screen.getByText("DEV-0002")).toBeInTheDocument();
    expect(screen.getByText("อุปกรณ์ที่เอาออก")).toBeInTheDocument();
    expect(screen.getByText("DEV-0003")).toBeInTheDocument();
  });

  it("กดเริ่ม Rollout: ส่งเครื่องที่เอาออกไปใน excludeDeviceIds", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await user.click(
      screen.getByRole("button", { name: "เอาเครื่องเหล่านี้ออกจากรอบนี้" }),
    );
    await next(user);
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    expect(createCampaignRollout).toHaveBeenCalledWith("tok", "camp-1", {
      payloadType: "Config",
      configId: "cfg-gt06n",
      excludeDeviceIds: ["DEV-0003"],
    });
  });

  async function goToReview(user: ReturnType<typeof userEvent.setup>) {
    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);
    await user.click(
      screen.getByRole("button", { name: "เอาเครื่องเหล่านี้ออกจากรอบนี้" }),
    );
    await next(user);
  }

  it("ขั้นยืนยัน: มีช่องลองส่งใหม่อัตโนมัติ ค่าเริ่มต้นตามกลุ่ม (เปิด) · ไม่เปลี่ยนค่าก็ไม่เรียก updateCampaign", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await goToReview(user);

    const box = screen.getByRole("checkbox", { name: /ลองส่งใหม่อัตโนมัติ/ });
    expect(box).toBeChecked();
    expect(
      screen.getByText(/ค่านี้จะถูกจำไว้ใช้กับ Rollout ครั้งถัดไป/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it("กลุ่มปิดอยู่: ช่องไม่ติ๊กตั้งแต่แรก · ติ๊กเปิดแล้วเริ่ม -> สร้าง Rollout ก่อน แล้วบันทึก autoRetry=true ให้กลุ่ม", async () => {
    hookState.campaign = { autoRetry: false };
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await goToReview(user);

    const box = screen.getByRole("checkbox", { name: /ลองส่งใหม่อัตโนมัติ/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() =>
      expect(updateCampaign).toHaveBeenCalledWith("tok", "camp-1", {
        autoRetry: true,
      }),
    );
    expect(createCampaignRollout.mock.invocationCallOrder[0]).toBeLessThan(
      updateCampaign.mock.invocationCallOrder[0],
    );
  });

  it("โหลดกลุ่มไม่สำเร็จ: ช่องลองส่งใหม่ถูกล็อกพร้อมคำอธิบาย และเริ่ม Rollout แล้วไม่เรียก updateCampaign", async () => {
    hookState.campaign = null;
    hookState.campaignError = "boom";
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await goToReview(user);

    expect(
      screen.getByRole("checkbox", { name: /ลองส่งใหม่อัตโนมัติ/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("checkbox", { name: /ลองส่งใหม่อัตโนมัติ/ }),
    ).not.toBeChecked();
    expect(
      screen.getByText(/โหลดการตั้งค่าของกลุ่มไม่สำเร็จ/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it("ติ๊กปิดแล้วเริ่ม: บันทึก autoRetry=false · บันทึกไม่สำเร็จก็ไม่ย้อน Rollout แค่เตือน", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    updateCampaign.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);
    await goToReview(user);

    await user.click(
      screen.getByRole("checkbox", { name: /ลองส่งใหม่อัตโนมัติ/ }),
    );
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() =>
      expect(updateCampaign).toHaveBeenCalledWith("tok", "camp-1", {
        autoRetry: false,
      }),
    );
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(createCampaignRollout).toHaveBeenCalledTimes(1);
  });

  it("เอาเครื่องที่ไม่เข้ากันออกตั้งแต่ขั้นแรก: ไปต่อได้เลย และ excludeDeviceIds ไม่ซ้ำ", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await user.click(checkboxFor("DEV-0002"));
    await user.click(checkboxFor("DEV-0003"));
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

  it("ไม่มีเครื่องไหนเข้ากันเลย: ไปต่อไม่ได้ ไม่ยิง API และบอกให้เลือก payload อื่น", async () => {
    hookState.targets = [{ deviceId: "DEV-0003" }];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);

    expect(createCampaignRollout).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /ถัดไป/ })).toBeDisabled();
  });
});

/** กลุ่มผูกได้รุ่นเดียว (13 พ.ย. 2569): ตัวเลือก payload เหลือแค่ของรุ่นนี้ และข้ามขั้นตรวจเมื่อไม่มีเครื่องไม่เข้ากัน */
describe("CampaignRolloutCreateForm: กลุ่มที่มีรุ่น", () => {
  const vt300Config: Config = {
    ...gt06nConfig,
    id: "cfg-vt300",
    name: "VT300 มาตรฐาน",
    deviceModel: "VT300",
    modelId: "model-VT300",
  };

  beforeEach(() => {
    createCampaignRollout.mockReset();
    hookState.campaign = { autoRetry: true, modelId: "model-GT06N" };
    hookState.campaignError = null;
    hookState.targets = [{ deviceId: "DEV-0001" }, { deviceId: "DEV-0002" }];
    hookState.devices = devices;
    hookState.configs = [gt06nConfig, vt300Config];
  });

  it("ตัวเลือก Config มีแค่ของรุ่นกลุ่ม", async () => {
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await user.click(screen.getByRole("combobox", { name: "Config" }));

    expect(
      await screen.findByRole("option", { name: /GT06N มาตรฐาน/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /VT300 มาตรฐาน/ }),
    ).not.toBeInTheDocument();
  });

  it("ทุกเครื่องเข้ากัน: ไม่มีขั้นตรวจสอบผลกระทบ ถัดไปจากเลือก Config ไปยืนยันเลย ย้อนกลับมาที่เลือก Config", async () => {
    createCampaignRollout.mockResolvedValue({ id: "roll-1" });
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    expect(screen.queryByText("ตรวจสอบผลกระทบ")).not.toBeInTheDocument();
    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);

    expect(screen.getByText("ตรวจสอบก่อนเริ่ม")).toBeInTheDocument();
    expect(screen.getByText("2 จาก 2 เครื่อง")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ย้อนกลับ/ }));
    expect(screen.getByRole("combobox", { name: "Config" })).toBeInTheDocument();
    await next(user);
    await user.click(screen.getByRole("button", { name: "เริ่ม Rollout" }));

    await waitFor(() => expect(createCampaignRollout).toHaveBeenCalledTimes(1));
    expect(createCampaignRollout).toHaveBeenCalledWith("tok", "camp-1", {
      payloadType: "Config",
      configId: "cfg-gt06n",
    });
  });

  it("มีเครื่องไม่เข้ากันจริง (protocol ต่าง): ยังแสดงขั้นตรวจสอบผลกระทบ", async () => {
    hookState.devices = [
      makeDevice("DEV-0001", "GT06N"),
      makeDevice("DEV-0002", "GT06N", "HTTP"),
    ];
    const user = userEvent.setup();
    render(<CampaignRolloutCreateForm campaignId="camp-1" />);

    await next(user);
    await selectConfig(user, /GT06N มาตรฐาน/);
    await next(user);

    expect(
      screen.getByText(/โปรโตคอล HTTP ไม่ตรงกับ Config นี้/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ถัดไป/ })).toBeDisabled();
  });
});
