import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ParameterManageControls } from "./parameter-manage-controls";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "ConfigEngineer" } }),
}));

const updateMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const usageMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/config-definition-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/config-definition-api")
  >("@/lib/config-definition-api");
  return {
    ...actual,
    updateConfigDefinition: updateMock,
    deleteConfigDefinition: deleteMock,
    getConfigDefinitionUsage: usageMock,
  };
});

const definition: ConfigFieldDefinition = {
  id: "d1",
  fieldName: "SPEED_LIMIT",
  dataType: "integer",
  allowedValues: [],
  required: false,
  unknownSpec: false,
  description: "จำกัดความเร็ว",
  unit: "km/h",
  stOverridable: false,
  category: null,
  sensitive: false,
  restartRequired: false,
  defaultValue: null,
  minValue: 0,
  maxValue: 200,
  supportedModels: [{ deviceModel: "GT06N", protocol: "TCP" }],
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  usageMock.mockResolvedValue({ count: 0, configs: [] });
});

describe("ParameterManageControls", () => {
  it("แก้หน่วยแล้วบันทึก -> เรียก updateConfigDefinition (ไม่ส่ง fieldName) และ onChanged", async () => {
    updateMock.mockResolvedValue(definition);
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <ParameterManageControls
        definition={definition}
        onChanged={onChanged}
        onDeleted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /แก้ไข/ }));
    const unit = screen.getByLabelText("หน่วย");
    await user.clear(unit);
    await user.type(unit, "mph");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, id, input] = updateMock.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe("d1");
    expect(input.unit).toBe("mph");
    expect(input).not.toHaveProperty("fieldName");
    expect(input.minValue).toBe(0);
    expect(input.maxValue).toBe(200);
  });

  it("ชนิดไม่ใช่ตัวเลข -> ไม่ส่ง min/max และไม่แสดงช่องค่าต่ำสุด/สูงสุด", async () => {
    updateMock.mockResolvedValue(definition);
    const user = userEvent.setup();
    render(
      <ParameterManageControls
        definition={{ ...definition, dataType: "string", minValue: null, maxValue: null }}
        onChanged={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /แก้ไข/ }));
    expect(screen.queryByLabelText("ค่าต่ำสุด")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const input = (updateMock.mock.calls[0] as [string, string, object])[2];
    expect(input).not.toHaveProperty("minValue");
  });

  it("มี Config ใช้อยู่ -> แก้ได้แต่แสดงคำเตือน", async () => {
    usageMock.mockResolvedValue({
      count: 2,
      configs: [
        { id: "c1", name: "Config A" },
        { id: "c2", name: "Config B" },
      ],
    });
    const user = userEvent.setup();
    render(
      <ParameterManageControls
        definition={definition}
        onChanged={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /แก้ไข/ }));

    expect(await screen.findByText(/มี Config ใช้พารามิเตอร์นี้อยู่ 2 ตัว/)).toBeInTheDocument();
  });

  it("ลบ: ไม่มี Config ใช้ -> ยืนยันแล้วเรียก deleteConfigDefinition และ onDeleted", async () => {
    deleteMock.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(
      <ParameterManageControls
        definition={definition}
        onChanged={vi.fn()}
        onDeleted={onDeleted}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ลบ/ }));
    await user.click(await screen.findByRole("button", { name: "ยืนยันลบ" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteMock).toHaveBeenCalledWith("tok", "d1");
  });

  it("ลบ: มี Config ใช้อยู่ -> ปุ่มยืนยันกดไม่ได้และบอกเหตุผล", async () => {
    usageMock.mockResolvedValue({
      count: 1,
      configs: [{ id: "c1", name: "Config A" }],
    });
    const user = userEvent.setup();
    render(
      <ParameterManageControls
        definition={definition}
        onChanged={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ลบ/ }));

    expect(await screen.findByText(/ลบไม่ได้ เพราะมี Config ใช้อยู่ 1 ตัว/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันลบ" })).toBeDisabled();
  });
});
