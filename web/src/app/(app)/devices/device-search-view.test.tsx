import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeviceSearchView } from "./device-search-view";
import type { Device } from "@/lib/device-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { role: "Admin", accessToken: "tok" } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/devices",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const useDevices = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-devices", () => ({ useDevices }));
vi.mock("@/hooks/use-central-devices", () => ({
  useCentralDevices: () => ({ data: null }),
}));
vi.mock("@/hooks/use-firmware", () => ({
  useFirmwareList: () => ({ data: [] }),
}));

const device: Device = {
  id: "d1",
  deviceId: "DEV-1",
  simNumber: "0811111111",
  deviceModel: "GT06N",
  protocol: "TCP",
  hardwareRevisionCode: null,
  imei: null,
  serialNumber: null,
  blackboxId: null,
  status: "installed",
  registeredAt: "2026-01-01T00:00:00Z",
  installedAt: null,
  decommissionedAt: null,
  decommissionReason: null,
  customer: null,
};

describe("DeviceSearchView: เครื่องที่ปลดระวางแล้ว", () => {
  beforeEach(() => {
    useDevices.mockReset();
    useDevices.mockReturnValue({
      data: [device],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("ซ่อนเป็นค่าเริ่มต้น และติ๊ก 'แสดงเครื่องที่ปลดระวางแล้ว' แล้วโหลดรายการใหม่แบบรวมเครื่องที่ปลดระวาง", async () => {
    const user = userEvent.setup();
    render(<DeviceSearchView />);

    expect(useDevices).toHaveBeenLastCalledWith({
      includeDecommissioned: false,
    });

    await user.click(
      screen.getByRole("checkbox", { name: "แสดงเครื่องที่ปลดระวางแล้ว" }),
    );

    expect(useDevices).toHaveBeenLastCalledWith({
      includeDecommissioned: true,
    });
  });
});
