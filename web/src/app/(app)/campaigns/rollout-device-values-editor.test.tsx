import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RolloutDeviceValuesEditor } from "./rollout-device-values-editor";
import type { Config } from "@/lib/config-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

const config: Config = {
  id: "cfg-1",
  name: "GT06N มาตรฐาน",
  deviceModel: "GT06N",
  protocol: "TCP",
  description: null,
  status: "approved",
  fields: {
    SPEED_LIMIT: 120,
    APN: "internet",
    COMMAND_PASSWORD: "s3cr3t",
  },
  createdBy: "u1",
  approvedBy: "u2",
  suggestedApproverId: null,
  clonedFromId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

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
    supportedModels: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ConfigFieldDefinition;
}

const definitions = [
  def("SPEED_LIMIT", { dataType: "integer", unit: "km/h" }),
  def("APN", { dataType: "string" }),
  def("COMMAND_PASSWORD", { dataType: "string", sensitive: true }),
];

function setup(
  overrides: Partial<React.ComponentProps<typeof RolloutDeviceValuesEditor>> = {},
) {
  const onSave = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <RolloutDeviceValuesEditor
      open
      onOpenChange={onOpenChange}
      deviceId="DEV-0001"
      config={config}
      definitions={definitions}
      baseFields={{}}
      edits={{}}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave, onOpenChange };
}

describe("RolloutDeviceValuesEditor", () => {
  it("แสดงชื่อเครื่อง พารามิเตอร์ทั้งหมดของ Config และค่าแม่แบบ (ค่าอ่อนไหวถูก mask)", () => {
    setup();

    expect(screen.getByText("ค่าเฉพาะเครื่อง DEV-0001")).toBeInTheDocument();
    expect(screen.getByLabelText("SPEED_LIMIT")).toBeInTheDocument();
    expect(screen.getByLabelText("APN")).toBeInTheDocument();
    expect(screen.getByText(/120/)).toBeInTheDocument();
    expect(screen.queryByText(/s3cr3t/)).not.toBeInTheDocument();
  });

  it("กรอกค่าที่ถูกชนิดแล้วบันทึก: ส่งค่าที่แปลงชนิดแล้วและปิดแผง", async () => {
    const user = userEvent.setup();
    const { onSave, onOpenChange } = setup();

    await user.type(screen.getByLabelText("SPEED_LIMIT"), "180");
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    expect(onSave).toHaveBeenCalledWith({ SPEED_LIMIT: 180 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ชนิดข้อมูลผิด: แสดงข้อผิดพลาดที่ช่องนั้น ไม่บันทึก", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();

    await user.type(screen.getByLabelText("SPEED_LIMIT"), "เร็ว");
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    expect(await screen.findByText("ต้องเป็นจำนวนเต็ม")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ค่าที่เท่ากับแม่แบบไม่นับเป็นการแก้", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();

    await user.type(screen.getByLabelText("SPEED_LIMIT"), "120");
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    expect(onSave).toHaveBeenCalledWith({});
  });

  it("ค่าพิเศษเดิมที่ยืนยันให้ใช้ต่อ: แสดงเป็นค่าตั้งต้นของช่องนั้น และค่าเท่ากับค่านั้นไม่นับเป็นการแก้", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ baseFields: { SPEED_LIMIT: 180 } });

    expect(screen.getByText(/ค่าพิเศษเดิม/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("SPEED_LIMIT"), "180");
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    expect(onSave).toHaveBeenCalledWith({});
  });

  it("แก้ไว้แล้วเปิดใหม่: แสดงค่าที่แก้ไว้ และคืนค่าทีละช่องได้", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ edits: { APN: "true-internet" } });

    expect(screen.getByLabelText("APN")).toHaveValue("true-internet");
    await user.click(screen.getByRole("button", { name: "คืนค่า APN" }));
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    expect(onSave).toHaveBeenCalledWith({});
  });

  it("ค้นหาพารามิเตอร์: กรองรายการตามชื่อ", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText("ค้นหาพารามิเตอร์"), "apn");

    expect(screen.getByLabelText("APN")).toBeInTheDocument();
    expect(screen.queryByLabelText("SPEED_LIMIT")).not.toBeInTheDocument();
  });

  it("รีเซ็ตทั้งหมด: ล้างทุกช่องที่กรอก", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ edits: { APN: "x", SPEED_LIMIT: 200 } });

    await user.click(screen.getByRole("button", { name: "รีเซ็ตทั้งหมด" }));
    await user.click(
      screen.getByRole("button", { name: "บันทึกค่าของเครื่องนี้" }),
    );

    expect(onSave).toHaveBeenCalledWith({});
  });
});
