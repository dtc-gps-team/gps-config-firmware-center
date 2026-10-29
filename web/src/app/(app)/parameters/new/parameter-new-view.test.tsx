import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ParameterNewView } from "./parameter-new-view";

const push = vi.hoisted(() => vi.fn());
const role = vi.hoisted(() => ({ value: "ConfigEngineer" as string }));
const createConfigDefinition = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ isReady: true, session: { accessToken: "tok", role: role.value } }),
}));
vi.mock("@/lib/config-definition-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/config-definition-api")>()),
  createConfigDefinition,
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({
    data: [{ fieldName: "APN1" }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-device-models", () => ({
  useDeviceModels: () => ({
    data: [{ id: "m1", name: "GT06N", supportedProtocols: ["TCP"], status: "active" }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe("ParameterNewView", () => {
  beforeEach(() => {
    push.mockReset();
    createConfigDefinition.mockReset();
    createConfigDefinition.mockResolvedValue({});
    role.value = "ConfigEngineer";
  });

  it("shows the form on its own page and goes back to the library on cancel", async () => {
    const user = userEvent.setup();
    render(<ParameterNewView />);

    expect(screen.getByRole("heading", { name: "สร้าง Parameter ใหม่" })).toBeInTheDocument();
    expect(screen.queryByText("รายการ Parameter ทั้งหมด")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(push).toHaveBeenCalledWith("/parameters");
  });

  it("opens the new field in the library after saving", async () => {
    const user = userEvent.setup();
    render(<ParameterNewView />);

    fireEvent.change(screen.getByLabelText("ชื่อ field"), { target: { value: "new_field" } });
    await user.click(screen.getByRole("button", { name: /เลือกโมเดล/ }));
    await user.click(screen.getByRole("checkbox", { name: /GT06N/ }));
    await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/parameters?param=new_field"));
  });

  it("blocks roles that cannot create parameters", () => {
    role.value = "Operation";
    render(<ParameterNewView />);
    expect(screen.queryByLabelText("ชื่อ field")).not.toBeInTheDocument();
  });
});
