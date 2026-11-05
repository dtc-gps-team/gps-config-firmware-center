import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { OverrideFieldDiffList } from "./override-field-diff-list";

const state = vi.hoisted(() => ({
  config: null as { fields: Record<string, unknown> } | null,
  definitions: [] as { fieldName: string; sensitive: boolean }[],
}));

vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({ data: state.definitions, isLoading: false }),
}));
vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({ data: state.config, isLoading: false, error: null }),
}));

describe("OverrideFieldDiffList", () => {
  beforeEach(() => {
    state.config = { fields: { speed_limit: 80, apn: "internet" } };
    state.definitions = [];
  });

  it("แสดงค่าเดิมคู่กับค่าที่ขอ, ค่าที่ไม่เปลี่ยน และ field ที่ไม่มีใน Config", () => {
    render(
      <OverrideFieldDiffList
        configId="c1"
        fields={{ speed_limit: 120, apn: "internet", new_field: "x" }}
      />,
    );

    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("(ค่าเดิม ไม่เปลี่ยน)")).toBeInTheDocument();
    expect(screen.getByText("ไม่มีใน Config")).toBeInTheDocument();
  });

  it("field sensitive ซ่อนทั้งค่าเดิมและค่าที่ขอ ไม่มี plaintext บนหน้า", () => {
    state.config = { fields: { pw: "old-secret" } };
    state.definitions = [{ fieldName: "pw", sensitive: true }];

    render(<OverrideFieldDiffList configId="c1" fields={{ pw: "new-secret" }} />);

    expect(screen.queryByText("old-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("new-secret")).not.toBeInTheDocument();
    expect(screen.getAllByText("••••••••")).toHaveLength(2);
  });

  it("โหลด Config ไม่ได้ -> แสดงเฉพาะค่าที่ขอ ไม่มีป้ายเทียบค่าเดิม", () => {
    state.config = null;

    render(<OverrideFieldDiffList configId="c1" fields={{ speed_limit: 120 }} />);

    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.queryByText("ไม่มีใน Config")).not.toBeInTheDocument();
    expect(screen.queryByText("(ค่าเดิม ไม่เปลี่ยน)")).not.toBeInTheDocument();
  });
});
