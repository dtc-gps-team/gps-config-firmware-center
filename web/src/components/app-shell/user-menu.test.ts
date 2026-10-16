import { describe, expect, it } from "vitest";

import { formatRoleLabel } from "./user-menu";

describe("formatRoleLabel", () => {
  it.each([
    ["ConfigEngineer", "Config Engineer"],
    ["FirmwareEngineer", "Firmware Engineer"],
    ["QAEngineer", "QA Engineer"],
    ["SuperAdmin", "Super Admin"],
    ["Operation", "Operation"],
    ["ST", "ST"],
  ])("%s → %s", (role, label) => {
    expect(formatRoleLabel(role)).toBe(label);
  });
});
