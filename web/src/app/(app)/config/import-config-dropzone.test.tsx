import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ImportConfigForm } from "./import-config-form";

const importConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/config-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/config-api")>()),
  importConfig,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "ConfigEngineer" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom ยังไม่มี Blob.text() (เบราว์เซอร์จริงมี) จึงจำลองด้วย FileReader
if (typeof File.prototype.text !== "function") {
  Object.defineProperty(File.prototype, "text", {
    value(this: Blob) {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(this);
      });
    },
  });
}

function jsonFile(body: object, name = "cfg.json") {
  return new File([JSON.stringify(body)], name, { type: "application/json" });
}

describe("ImportConfigForm dropzone", () => {
  it("accepts a dropped file, shows its name and a ready preview, then imports", async () => {
    importConfig.mockResolvedValue({ id: "c1", name: "x" });
    const onImported = vi.fn();
    const user = userEvent.setup();
    render(<ImportConfigForm onImported={onImported} />);

    const zone = screen.getByText("ไฟล์ Config (.json)").closest("div")!;
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [jsonFile({ name: "A", deviceModel: "GT06N", protocol: "TCP", settings: { APN1: "x" } })],
      },
    });

    expect(await screen.findByText("ไฟล์พร้อมนำเข้า")).toBeInTheDocument();
    expect(screen.getByText(/cfg\.json/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "นำเข้า" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("warns when required keys are missing and keeps import disabled for bad JSON", async () => {
    render(<ImportConfigForm onImported={vi.fn()} />);
    const zone = screen.getByText("ไฟล์ Config (.json)").closest("div")!;

    fireEvent.drop(zone, { dataTransfer: { files: [jsonFile({ name: "A" })] } });
    expect(await screen.findByText("ไฟล์ยังไม่ครบ")).toBeInTheDocument();

    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["{oops"], "bad.json", { type: "application/json" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่ใช่ JSON");
    expect(screen.getByRole("button", { name: "นำเข้า" })).toBeDisabled();
  });
});
