import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ImportConfigForm } from "./import-config-form";

const importConfig = vi.hoisted(() => vi.fn());
const modelsState = vi.hoisted(() => ({
  data: null as
    | { id: string; name: string; supportedProtocols: string[] }[]
    | null,
}));
vi.mock("@/lib/config-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/config-api")>()),
  importConfig,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "ConfigEngineer" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-device-models", () => ({
  useDeviceModels: () => ({
    data: modelsState.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

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
  beforeEach(() => {
    modelsState.data = [{ id: "m-gt06n", name: "GT06N", supportedProtocols: ["TCP"] }];
  });

  it("accepts a dropped file, shows its name and a ready preview, then imports", async () => {
    importConfig.mockResolvedValue({ id: "c1", name: "x" });
    const onImported = vi.fn();
    const user = userEvent.setup();
    render(<ImportConfigForm onImported={onImported} />);

    const zone = screen.getByText("ไฟล์ Config (.json)").closest("div")!;
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [jsonFile({ name: "A", modelId: "m-gt06n", protocol: "TCP", settings: { APN1: "x" } })],
      },
    });

    expect(await screen.findByText("ไฟล์พร้อมนำเข้า")).toBeInTheDocument();
    // preview แสดงชื่อรุ่นจากทะเบียน ไม่ใช่ id
    expect(screen.getByText("GT06N")).toBeInTheDocument();
    expect(screen.getByText(/cfg\.json/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "นำเข้า" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("ไฟล์ระบุโมเดลด้วยชื่อ (deviceModel): พร้อมนำเข้า และแสดงชื่อโมเดล", async () => {
    render(<ImportConfigForm onImported={vi.fn()} />);
    const zone = screen.getByText("ไฟล์ Config (.json)").closest("div")!;

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [jsonFile({ name: "A", deviceModel: "GT06N", protocol: "TCP", settings: { APN1: "x" } })],
      },
    });

    expect(await screen.findByText("ไฟล์พร้อมนำเข้า")).toBeInTheDocument();
    expect(screen.getByText("GT06N")).toBeInTheDocument();
  });

  it("ชื่อโมเดลไม่อยู่ในทะเบียน: บอกว่าไม่พบ", async () => {
    render(<ImportConfigForm onImported={vi.fn()} />);
    const zone = screen.getByText("ไฟล์ Config (.json)").closest("div")!;

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [jsonFile({ name: "A", deviceModel: "XYZ", protocol: "TCP", settings: { APN1: "x" } })],
      },
    });

    expect(await screen.findByText("XYZ (ไม่พบโมเดลนี้ในระบบ)")).toBeInTheDocument();
  });

  it("ทะเบียนโมเดลยังโหลดไม่เสร็จ: แสดงชื่อจากไฟล์ ไม่บอกว่าไม่พบ", async () => {
    modelsState.data = null;
    render(<ImportConfigForm onImported={vi.fn()} />);
    const zone = screen.getByText("ไฟล์ Config (.json)").closest("div")!;

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [jsonFile({ name: "A", deviceModel: "XYZ", protocol: "TCP", settings: { APN1: "x" } })],
      },
    });

    expect(await screen.findByText("XYZ")).toBeInTheDocument();
    expect(screen.queryByText(/ไม่พบโมเดล/)).not.toBeInTheDocument();
  });

  it("ระบุทั้ง deviceModel และ modelId: บอกให้เหลืออย่างเดียว", async () => {
    render(<ImportConfigForm onImported={vi.fn()} />);
    const zone = screen.getByText("ไฟล์ Config (.json)").closest("div")!;

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [jsonFile({ name: "A", deviceModel: "GT06N", modelId: "m-gt06n", protocol: "TCP", settings: { APN1: "x" } })],
      },
    });

    expect(await screen.findByText("ไฟล์ยังไม่ครบ")).toBeInTheDocument();
    expect(screen.getByText(/ให้เหลืออย่างใดอย่างหนึ่ง/)).toBeInTheDocument();
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
