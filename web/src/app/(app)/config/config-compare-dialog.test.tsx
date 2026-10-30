import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Config } from "@/lib/config-api";
import { ConfigCompareDialog } from "./config-compare-dialog";

vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({
    data: [
      { fieldName: "interval", sensitive: false },
      { fieldName: "apn_password", sensitive: true },
    ],
    isLoading: false,
    error: null,
  }),
}));

function config(
  name: string,
  fields: Record<string, unknown>,
  deviceModel = "GT06N",
): Config {
  return {
    id: name,
    name,
    deviceModel,
    protocol: "TCP",
    description: null,
    status: "approved",
    fields,
    createdBy: "u1",
    approvedBy: null,
    suggestedApproverId: null,
    clonedFromId: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  } as Config;
}

const template = config("แม่แบบมาตรฐาน", {
  interval: 30,
  apn_password: "secret-a",
  only_base: 1,
});
const custom = config("งานรถบรรทุก", {
  interval: 60,
  apn_password: "secret-b",
  only_custom: 2,
});

describe("ConfigCompareDialog", () => {
  it("แสดงค่าที่ต่าง เพิ่ม/แก้ไข/ลบ และปิดค่า sensitive", () => {
    render(
      <ConfigCompareDialog pair={[template, custom]} onClose={() => {}} />,
    );

    expect(screen.getByText("เพิ่ม 1")).toBeInTheDocument();
    expect(screen.getByText("แก้ไข 2")).toBeInTheDocument();
    expect(screen.getByText("ลบ 1")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.queryByText("secret-a")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-b")).not.toBeInTheDocument();
  });

  it("สลับด้านแล้วค่าฐานกับค่าเทียบกลับกัน (เพิ่มกลายเป็นลบ)", async () => {
    const user = userEvent.setup();
    render(
      <ConfigCompareDialog pair={[template, custom]} onClose={() => {}} />,
    );

    await user.click(screen.getByRole("button", { name: /สลับด้าน/ }));

    expect(screen.getByText("เพิ่ม 1")).toBeInTheDocument();
    expect(screen.getByText("ลบ 1")).toBeInTheDocument();
    expect(screen.getByText(/งานรถบรรทุก \(ฐาน\)/)).toBeInTheDocument();
  });

  it("คนละโมเดล: เตือนว่าฟิลด์ที่มีฝั่งเดียวจะขึ้นเป็นเพิ่ม/ลบ", () => {
    render(
      <ConfigCompareDialog
        pair={[template, config("VT300 งาน", { interval: 30 }, "VT300")]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/เป็นคนละโมเดลหรือโปรโตคอล/)).toBeInTheDocument();
  });

  it("ค่าเหมือนกันทุกฟิลด์: บอกว่าเหมือนกัน", () => {
    render(
      <ConfigCompareDialog
        pair={[template, config("สำเนา", { ...template.fields })]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(/มีค่าเหมือนกันทุกฟิลด์/)).toBeInTheDocument();
  });
});
