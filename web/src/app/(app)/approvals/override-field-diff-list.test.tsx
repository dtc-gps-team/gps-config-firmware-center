import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { OverrideFieldDiffList } from "./override-field-diff-list";

vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({
    data: { fields: { speed_limit: 80, apn: "internet" } },
    isLoading: false,
    error: null,
  }),
}));

describe("OverrideFieldDiffList", () => {
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
});
