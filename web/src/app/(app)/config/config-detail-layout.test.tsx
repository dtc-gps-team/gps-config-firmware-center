import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfigDetailView } from "./config-detail-view";
import type { Config, ConfigVersion } from "@/lib/config-api";

const role = vi.hoisted(() => ({ value: "Operation" as string }));
const updateConfig = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: role.value } }),
}));
vi.mock("@/lib/config-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/config-api")>()),
  updateConfig,
}));

const state = vi.hoisted(() => ({ config: null as Config | null, versions: [] as ConfigVersion[] }));
vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({ data: state.config, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-config-versions", () => ({
  useConfigVersions: () => ({ data: state.versions, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({ resolveName: (id: string) => id, isLoading: false }),
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({
    data: [
      { fieldName: "SERVER_PORT", category: "Server", sensitive: false, restartRequired: false },
      { fieldName: "APN1", category: "Network", sensitive: false, restartRequired: false },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const base: Config = {
  id: "c1",
  name: "Test Config",
  deviceModel: "GT06N",
  protocol: "TCP",
  description: null,
  status: "approved",
  fields: { SERVER_PORT: 9000, APN1: "internet" },
  createdBy: "u1",
  approvedBy: "op",
  suggestedApproverId: null,
  clonedFromId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const v1: ConfigVersion = {
  id: "v1",
  configId: "c1",
  versionNumber: 1,
  deviceModel: "GT06N",
  protocol: "TCP",
  fields: { SERVER_PORT: 8080, APN1: "internet" },
  approvedBy: "op",
  approvedAt: "2026-01-02T00:00:00Z",
};

describe("ConfigDetailView layout", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/config/c1");
    updateConfig.mockReset();
    updateConfig.mockResolvedValue({});
    role.value = "Operation";
    state.config = base;
    state.versions = [v1];
  });

  it("groups parameters by category", () => {
    render(<ConfigDetailView configId="c1" />);
    expect(screen.getByRole("region", { name: "Server" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Network" })).toBeInTheDocument();
  });

  it("offers clone as the primary action only to roles that can create configs", () => {
    const { unmount } = render(<ConfigDetailView configId="c1" />);
    expect(screen.queryByRole("link", { name: /โคลนไปสร้างชุดใหม่/ })).not.toBeInTheDocument();
    unmount();

    role.value = "ConfigEngineer";
    render(<ConfigDetailView configId="c1" />);
    expect(screen.getByRole("link", { name: /โคลนไปสร้างชุดใหม่/ })).toHaveAttribute(
      "href",
      "/config/new?from=c1",
    );
  });

  it("compares a version with the current values", async () => {
    window.history.replaceState(null, "", "/config/c1?tab=versions");
    const user = userEvent.setup();
    render(<ConfigDetailView configId="c1" />);

    await user.click(screen.getByRole("button", { name: "เทียบกับค่าปัจจุบัน" }));
    expect(screen.getByText("แก้ไข 1")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ใส่ค่ากลับเข้า draft" })).not.toBeInTheDocument();
  });

  it("restores an old version into a draft after confirming", async () => {
    window.history.replaceState(null, "", "/config/c1?tab=versions");
    role.value = "ConfigEngineer";
    state.config = { ...base, status: "draft", createdBy: "u1" };
    const user = userEvent.setup();
    render(<ConfigDetailView configId="c1" />);

    await user.click(screen.getByRole("button", { name: "ใส่ค่ากลับเข้า draft" }));
    expect(updateConfig).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "ใส่ค่ากลับ" }));

    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith("tok", "c1", { fields: v1.fields }));
  });
});
