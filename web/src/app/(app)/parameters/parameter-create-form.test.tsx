import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ParameterCreateForm } from "./parameter-create-form";
import type { DeviceModel } from "@/lib/device-model-api";

const createConfigDefinition = vi.hoisted(() => vi.fn());
vi.mock("@/lib/config-definition-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/config-definition-api")>()),
  createConfigDefinition,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "ConfigEngineer" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const models = [
  { id: "m1", name: "GT06N", supportedProtocols: ["TCP"], status: "active" },
  { id: "m2", name: "BB-200", supportedProtocols: ["mqtt"], status: "active" },
] as unknown as DeviceModel[];

function setup(existing = new Set<string>()) {
  const onCreated = vi.fn();
  render(
    <ParameterCreateForm
      deviceModels={models}
      existingNames={existing}
      onCreated={onCreated}
      onCancel={vi.fn()}
    />,
  );
  return { onCreated };
}

describe("ParameterCreateForm", () => {
  beforeEach(() => {
    createConfigDefinition.mockReset();
    createConfigDefinition.mockResolvedValue({});
  });

  it("requires at least one model and rejects duplicate names", async () => {
    const user = userEvent.setup();
    setup(new Set(["apn1"]));

    await user.type(screen.getByLabelText("ชื่อ field"), "APN1");
    await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));
    expect(screen.getByText(/มี field ชื่อ "APN1" อยู่แล้ว/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ชื่อ field"), { target: { value: "NEW_FIELD" } });
    await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("เลือกโมเดลที่รองรับอย่างน้อย 1 โมเดล");
    expect(createConfigDefinition).not.toHaveBeenCalled();
  });

  it("builds supportedModels from the selected models and submits", async () => {
    const user = userEvent.setup();
    const { onCreated } = setup();

    fireEvent.change(screen.getByLabelText("ชื่อ field"), { target: { value: "report_interval" } });
    fireEvent.change(screen.getByLabelText("หน่วย (ไม่บังคับ)"), { target: { value: "วินาที" } });
    await user.click(screen.getByRole("button", { name: /เลือกโมเดล/ }));
    await user.click(screen.getByRole("checkbox", { name: /GT06N/ }));
    await user.click(screen.getByRole("checkbox", { name: /ต้องกรอก/ }));
    await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));

    await waitFor(() => expect(createConfigDefinition).toHaveBeenCalled());
    const body = createConfigDefinition.mock.calls[0][1];
    expect(body).toMatchObject({
      fieldName: "report_interval",
      required: true,
      unit: "วินาที",
      supportedModels: [{ deviceModel: "GT06N", protocol: "TCP" }],
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("takes allowed values one per line, trimmed and de-duplicated", async () => {
    const user = userEvent.setup();
    setup();

    fireEvent.change(screen.getByLabelText("ชื่อ field"), { target: { value: "network_mode" } });
    fireEvent.change(screen.getByLabelText(/ค่าที่เลือกได้/), {
      target: { value: "auto\n 2g \n\n4g\nauto" },
    });
    expect(screen.getByText("3 ค่า")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /เลือกโมเดล/ }));
    await user.click(screen.getByRole("checkbox", { name: /GT06N/ }));
    await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));

    await waitFor(() => expect(createConfigDefinition).toHaveBeenCalled());
    expect(createConfigDefinition.mock.calls[0][1].allowedValues).toEqual(["auto", "2g", "4g"]);
  });

  it("does not send a default value for sensitive fields and hides it from the preview", async () => {
    const user = userEvent.setup();
    setup();

    fireEvent.change(screen.getByLabelText("ชื่อ field"), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText("ค่าเริ่มต้น (ไม่บังคับ)"), { target: { value: "secret" } });
    await user.click(screen.getByRole("button", { name: /เลือกโมเดล/ }));
    await user.click(screen.getByRole("checkbox", { name: /BB-200/ }));
    await user.click(screen.getByRole("checkbox", { name: /ซ่อนค่า/ }));

    expect(screen.queryByLabelText("ค่าเริ่มต้น (ไม่บังคับ)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));
    await waitFor(() => expect(createConfigDefinition).toHaveBeenCalled());
    expect(createConfigDefinition.mock.calls[0][1]).not.toHaveProperty("defaultValue");
    expect(createConfigDefinition.mock.calls[0][1]).toMatchObject({ sensitive: true });
  });
});

describe("ParameterCreateForm model picker", () => {
  it("searches many models, selects the visible ones and removes chips", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      name: i < 5 ? `GT-${i}` : `BB-${i}`,
      supportedProtocols: ["TCP"],
      status: "active",
    })) as unknown as DeviceModel[];
    render(
      <ParameterCreateForm
        deviceModels={many}
        existingNames={new Set()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("ยังไม่ได้เลือกโมเดล เลือกอย่างน้อย 1 โมเดล")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /เลือกโมเดล/ }));
    await user.type(screen.getByLabelText("ค้นหาโมเดล"), "GT-");
    expect(screen.getAllByRole("checkbox", { name: /GT-/ })).toHaveLength(5);
    expect(screen.queryByRole("checkbox", { name: /BB-/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /เลือกที่แสดงทั้งหมด \(5\)/ }));
    const chips = screen.getByRole("list", { name: "โมเดลที่เลือกแล้ว" });
    expect(chips.querySelectorAll("li")).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "เอา GT-0 ออก" }));
    expect(chips.querySelectorAll("li")).toHaveLength(4);
  });
});
