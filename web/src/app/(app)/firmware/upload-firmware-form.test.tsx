import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UploadFirmwareForm } from "./upload-firmware-form";

const uploadFirmware = vi.hoisted(() => vi.fn());
vi.mock("@/lib/firmware-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/firmware-api")>()),
  uploadFirmware,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "FirmwareEngineer" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function file(name = "fw.bin", size = 1024) {
  const f = new File([new Uint8Array(8)], name, { type: "application/octet-stream" });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("UploadFirmwareForm", () => {
  beforeEach(() => {
    uploadFirmware.mockReset();
  });

  it("accepts a dropped file, shows its name, and reports upload progress", async () => {
    let report: (n: number) => void = () => {};
    let finish: (v: unknown) => void = () => {};
    uploadFirmware.mockImplementation(
      (_t: string, _i: unknown, onProgress: (n: number) => void) => {
        report = onProgress;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<UploadFirmwareForm onUploaded={onUploaded} />);

    const zone = screen.getByText("ไฟล์ Firmware").closest("div")!;
    fireEvent.drop(zone, { dataTransfer: { files: [file("gt06n-2.4.1.bin")] } });
    expect(await screen.findByText(/gt06n-2\.4\.1\.bin/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("เวอร์ชัน"), { target: { value: "2.4.1" } });
    fireEvent.change(screen.getByLabelText(/โมเดล/), { target: { value: "GT06N" } });
    await user.click(screen.getByRole("button", { name: "อัปโหลด" }));

    act(() => report(40));
    const bar = await screen.findByRole("progressbar", { name: "ความคืบหน้าการอัปโหลด" });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "40"));
    expect(screen.getByRole("button", { name: /กำลังอัปโหลด 40%/ })).toBeDisabled();

    finish({ id: "f1", version: "2.4.1" });
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
  });

  it("rejects a file over the size limit before uploading", async () => {
    render(<UploadFirmwareForm onUploaded={vi.fn()} />);
    const zone = screen.getByText("ไฟล์ Firmware").closest("div")!;
    fireEvent.drop(zone, { dataTransfer: { files: [file("big.bin", 60 * 1024 * 1024)] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("ไฟล์ใหญ่เกิน");
    expect(uploadFirmware).not.toHaveBeenCalled();
  });
});
