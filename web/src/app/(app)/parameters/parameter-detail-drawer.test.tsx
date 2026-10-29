import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ConfigFieldDefinition } from "@/lib/config-definition-api";
import { defaultSnippet, ParameterDetailDrawer } from "./parameter-detail-drawer";

function def(over: Partial<ConfigFieldDefinition>): ConfigFieldDefinition {
  return {
    id: "d1",
    fieldName: "SERVER_PORT",
    dataType: "integer",
    allowedValues: [],
    required: true,
    unknownSpec: false,
    description: "พอร์ตของ Server",
    unit: null,
    stOverridable: false,
    category: "Server",
    sensitive: false,
    restartRequired: true,
    defaultValue: "8080",
    supportedModels: [{ deviceModel: "GT06N", protocol: "TCP" }],
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("defaultSnippet", () => {
  it("emits typed JSON for numeric, boolean and string defaults", () => {
    expect(JSON.parse(defaultSnippet(def({}))!)).toEqual({ SERVER_PORT: 8080 });
    expect(
      JSON.parse(defaultSnippet(def({ dataType: "boolean", defaultValue: "true" }))!),
    ).toEqual({ SERVER_PORT: true });
    expect(
      JSON.parse(defaultSnippet(def({ dataType: "string", defaultValue: "abc" }))!),
    ).toEqual({ SERVER_PORT: "abc" });
    expect(defaultSnippet(def({ defaultValue: null }))).toBeNull();
  });
});

describe("ParameterDetailDrawer", () => {
  it("shows type, default, allowed values and models", () => {
    render(
      <ParameterDetailDrawer
        definition={def({ allowedValues: ["80", "8080"] })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("SERVER_PORT").length).toBeGreaterThan(0);
    expect(screen.getByText("ต้อง Restart กล่อง")).toBeInTheDocument();
    expect(screen.getByText("integer")).toBeInTheDocument();
    expect(screen.getByText("GT06N")).toBeInTheDocument();
    expect(screen.getAllByText("8080").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "คัดลอกชื่อ field" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คัดลอก snippet" })).toBeInTheDocument();
  });

  it("hides the default snippet and masks the default for sensitive fields", () => {
    render(
      <ParameterDetailDrawer
        definition={def({ sensitive: true, dataType: "string", defaultValue: "s3cret" })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("s3cret")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "คัดลอก snippet" })).not.toBeInTheDocument();
  });

  it("renders nothing when no definition is open", () => {
    render(<ParameterDetailDrawer definition={null} onClose={vi.fn()} />);
    expect(screen.queryByText("ค่าที่ยอมรับ")).not.toBeInTheDocument();
  });
});
