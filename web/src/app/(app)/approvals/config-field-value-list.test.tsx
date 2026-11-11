import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ConfigFieldValueList } from "./config-field-value-list";

type Q = { data: unknown; isLoading: boolean; error: string | null };

const state = vi.hoisted(() => ({
  config: { data: null, isLoading: false, error: null } as Q,
  definitions: { data: [], isLoading: false, error: null } as Q,
}));

vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({ ...state.config, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({ ...state.definitions, refetch: vi.fn() }),
}));
vi.mock("@/components/config/use-description-by-field", () => ({
  useDescriptionByField: () => new Map(),
}));
vi.mock("@/components/config/config-field-label", () => ({
  ConfigFieldLabel: ({ fieldName }: { fieldName: string }) => (
    <span>{fieldName}</span>
  ),
}));
vi.mock("@/components/sensitive-value", () => ({
  SensitiveValue: () => <span>ซ่อนค่า</span>,
}));

beforeEach(() => {
  state.config = {
    data: {
      id: "cfg-1",
      fields: { "gps.send_interval_sec": 30, COMMAND_PASSWORD: "s3cr3t" },
    },
    isLoading: false,
    error: null,
  };
  state.definitions = {
    data: [{ fieldName: "COMMAND_PASSWORD", sensitive: true }],
    isLoading: false,
    error: null,
  };
});

describe("ConfigFieldValueList", () => {
  it("แสดงค่าจาก Config และซ่อนค่าที่เป็นความลับ", () => {
    render(
      <ConfigFieldValueList
        configId="cfg-1"
        fieldNames={["gps.send_interval_sec", "COMMAND_PASSWORD"]}
      />,
    );

    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getByText("ซ่อนค่า")).toBeInTheDocument();
  });

  it("ระหว่างโหลด definitions: ซ่อนทุกค่าไว้ก่อน", () => {
    state.definitions = { data: null, isLoading: true, error: null };
    render(
      <ConfigFieldValueList
        configId="cfg-1"
        fieldNames={["gps.send_interval_sec"]}
      />,
    );

    expect(screen.queryByText("30")).not.toBeInTheDocument();
    expect(screen.getByText("ซ่อนค่า")).toBeInTheDocument();
  });

  it("โหลด definitions ไม่สำเร็จ (เช่น Auditor ได้ 403): ค่ายังถูกซ่อน", () => {
    state.definitions = { data: null, isLoading: false, error: "forbidden" };
    render(
      <ConfigFieldValueList
        configId="cfg-1"
        fieldNames={["gps.send_interval_sec", "COMMAND_PASSWORD"]}
      />,
    );

    expect(screen.queryByText("30")).not.toBeInTheDocument();
    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getAllByText("ซ่อนค่า")).toHaveLength(2);
  });

  it("field ที่ Override แก้: ไม่แสดงค่าของ Config ชี้ไปส่วน Override", () => {
    render(
      <ConfigFieldValueList
        configId="cfg-1"
        fieldNames={["gps.send_interval_sec"]}
        overriddenFields={["gps.send_interval_sec"]}
      />,
    );

    expect(screen.queryByText("30")).not.toBeInTheDocument();
    expect(
      screen.getByText("ใช้ค่าที่ช่างขอแก้ (ดูด้านล่าง)"),
    ).toBeInTheDocument();
  });

  it("โหลด Config ไม่สำเร็จ: แสดงชื่อ field และบอกว่าโหลดค่าไม่ได้", () => {
    state.config = { data: null, isLoading: false, error: "boom" };
    render(
      <ConfigFieldValueList
        configId="cfg-1"
        fieldNames={["gps.send_interval_sec"]}
      />,
    );

    expect(screen.getByText("gps.send_interval_sec")).toBeInTheDocument();
    expect(
      screen.getByText("โหลดค่าจาก Config ไม่สำเร็จ แสดงเฉพาะชื่อ field"),
    ).toBeInTheDocument();
  });
});
