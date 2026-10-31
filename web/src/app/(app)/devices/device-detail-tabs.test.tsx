import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceDetailView } from "./device-detail-view";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { role: "Operation", accessToken: "tok" } }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-device", () => ({
  useDevice: () => ({
    data: {
      id: "1",
      deviceId: "DEV-0001",
      simNumber: "0800000000",
      deviceModel: "GT06N",
      protocol: "TCP",
      hardwareRevisionCode: null,
      imei: null,
      serialNumber: null,
      blackboxId: null,
      status: "installed",
      registeredAt: "2026-01-01T00:00:00Z",
      installedAt: null,
      customer: null,
    },
    isLoading: false,
    notFound: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-device-status", () => ({
  useDeviceStatus: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-device-history", () => ({
  useDeviceHistory: () => ({
    summary: null,
    items: [],
    nextCursor: null,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    loadMore: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({ resolveName: (id: string) => id }),
}));
vi.mock("@/hooks/use-firmware", () => ({
  useFirmwareList: () => ({
    data: [
      {
        id: "f1",
        version: "2.0.0",
        deviceModelCompatibility: ["GT06N"],
        uploadStatus: "stored",
        approvalStatus: "approved",
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-central-devices", () => ({
  useDeviceCentral: () => ({
    data: {
      mode: "real",
      reachable: true,
      error: null,
      fetchedAt: "2026-10-01T00:00:00Z",
      device: {
        deviceId: "DEV-0001",
        hardwareModel: "GT06N",
        online: true,
        lastSeenAt: new Date().toISOString(),
        reportedFirmwareVersion: "1.9.0",
        reportedConfigVersion: 3,
        reportedSchemaVersion: 1,
        desiredConfigVersion: 4,
        registered: true,
        lastCommand: null,
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe("DeviceDetailView tabs", () => {
  it("summary bar warns when reported firmware is behind the latest approved", () => {
    render(<DeviceDetailView deviceId="DEV-0001" />);
    const bar = screen.getByTestId("device-summary-bar");
    expect(bar).toHaveTextContent("1.9.0");
    expect(bar).toHaveTextContent("ล้าสมัย");
  });

  it("switches tab with the keyboard and reflects it in the URL", async () => {
    window.history.replaceState(null, "", "/devices/DEV-0001");
    const user = userEvent.setup();
    render(<DeviceDetailView deviceId="DEV-0001" />);

    const overview = screen.getByRole("tab", { name: "ภาพรวม" });
    overview.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Config" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(window.location.search).toBe("?tab=config");
    expect(screen.getByText("ยังไม่ตรงเป้าหมาย")).toBeInTheDocument();
  });

  it("opens the tab named in the URL", () => {
    window.history.replaceState(null, "", "/devices/DEV-0001?tab=telemetry");
    render(<DeviceDetailView deviceId="DEV-0001" />);
    expect(screen.getByRole("tab", { name: "Telemetry" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    window.history.replaceState(null, "", "/");
  });
});
