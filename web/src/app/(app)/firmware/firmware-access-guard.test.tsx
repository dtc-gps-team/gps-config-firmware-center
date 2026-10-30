import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { FirmwareAccessGuard } from "./firmware-access-guard";

const role = vi.hoisted(() => ({ value: "Operation" as string }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ isReady: true, session: { accessToken: "t", role: role.value } }),
}));

describe("FirmwareAccessGuard", () => {
  it("shows content to roles that can read firmware and blocks ConfigEngineer", () => {
    role.value = "QAEngineer";
    const { unmount } = render(<FirmwareAccessGuard>เนื้อหา Firmware</FirmwareAccessGuard>);
    expect(screen.getByText("เนื้อหา Firmware")).toBeInTheDocument();
    unmount();

    role.value = "ConfigEngineer";
    render(<FirmwareAccessGuard>เนื้อหา Firmware</FirmwareAccessGuard>);
    expect(screen.queryByText("เนื้อหา Firmware")).not.toBeInTheDocument();
  });
});
