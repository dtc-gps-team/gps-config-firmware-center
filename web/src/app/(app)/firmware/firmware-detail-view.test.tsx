import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FirmwareDetailView } from "./firmware-detail-view";
import type { Firmware } from "@/lib/firmware-api";

// ค่าเริ่มต้น Auditor ไม่มีสิทธิ์พิเศษอะไรเลย (แก้/อนุมัติ/ทดสอบ) ตัดทุก panel ออก
// กันชนกับ InfoRow ที่ทดสอบอยู่ · เทสปุ่มลบสลับ role เอง
const authState = vi.hoisted(() => ({ role: "Auditor" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: { accessToken: "tok", role: authState.role },
  }),
}));

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const deleteFirmwareMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/firmware-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/firmware-api")>(
    "@/lib/firmware-api",
  );
  return { ...actual, deleteFirmware: deleteFirmwareMock };
});

const firmwareState = vi.hoisted(() => ({
  data: null as Firmware | null,
}));
vi.mock("@/hooks/use-firmware", () => ({
  useFirmware: () => ({
    data: firmwareState.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({
    resolveName: (id: string) =>
      ({ "fw-eng-1": "Firmware Engineer Tester" })[id] ?? id,
    isLoading: false,
  }),
}));

const baseFirmware: Firmware = {
  id: "fw-1",
  version: "2.4.1",
  deviceModelCompatibility: ["GT06N"],
  uploadStatus: "stored",
  deviceUpdateStatus: "unknown",
  objectKey: "fw/fw-1.bin",
  originalFilename: "firmware.bin",
  fileSizeBytes: 1024,
  checksumSha256: "a".repeat(64),
  uploadedBy: "fw-eng-1",
  uploadedAt: "2026-01-01T00:00:00Z",
  approvalStatus: "pending_review",
  approvedBy: null,
  deletedAt: null,
};

/**
 * PR แก้ UUID ดิบที่ "อัปโหลดโดย" (พบจาก UX/UI audit — เหมือน
 * config-detail-view.test.tsx)
 */
describe("FirmwareDetailView — แก้ UUID ดิบที่ 'อัปโหลดโดย'", () => {
  it("โชว์ชื่อที่ resolve แล้ว ไม่ใช่ userId ดิบ", () => {
    firmwareState.data = baseFirmware;

    render(<FirmwareDetailView firmwareId="fw-1" />);

    expect(screen.getByText("Firmware Engineer Tester")).toBeInTheDocument();
    expect(screen.queryByText("fw-eng-1")).not.toBeInTheDocument();
  });

  it("userId ที่ resolve ไม่เจอ (บัญชีถูกปิดใช้งานไปแล้ว) -> fallback โชว์ id เดิม", () => {
    firmwareState.data = { ...baseFirmware, uploadedBy: "unknown-user" };

    render(<FirmwareDetailView firmwareId="fw-1" />);

    expect(screen.getByText("unknown-user")).toBeInTheDocument();
  });
});

describe("FirmwareDetailView — SHA-256 checksum ให้ QA เทียบก่อนอนุมัติ", () => {
  it("มี checksum -> โชว์ hash เต็ม", () => {
    firmwareState.data = baseFirmware;

    render(<FirmwareDetailView firmwareId="fw-1" />);

    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });

  it("ไม่มี checksum (อัปโหลดก่อนมีฟีเจอร์นี้) -> โชว์ข้อความแทน ไม่ใช่ค่าว่าง", () => {
    firmwareState.data = { ...baseFirmware, checksumSha256: null };

    render(<FirmwareDetailView firmwareId="fw-1" />);

    expect(
      screen.getByText("ไม่มี (อัปโหลดก่อนมีฟีเจอร์นี้)"),
    ).toBeInTheDocument();
  });
});

describe("FirmwareDetailView: ปุ่มลบ Firmware", () => {
  it("Auditor ไม่เห็นปุ่มลบ", () => {
    authState.role = "Auditor";
    firmwareState.data = baseFirmware;

    render(<FirmwareDetailView firmwareId="fw-1" />);

    expect(
      screen.queryByRole("button", { name: "ลบ Firmware นี้" }),
    ).not.toBeInTheDocument();
  });

  it("FirmwareEngineer ยืนยันลบ -> เรียก deleteFirmware แล้วกลับหน้ารายการ", async () => {
    authState.role = "FirmwareEngineer";
    firmwareState.data = baseFirmware;
    deleteFirmwareMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<FirmwareDetailView firmwareId="fw-1" />);
    await user.click(screen.getByRole("button", { name: "ลบ Firmware นี้" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันลบ" }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/firmware"));
    expect(deleteFirmwareMock).toHaveBeenCalledWith("tok", "fw-1");
  });

  it("ลบไม่ได้ (409 มีกล่องรันอยู่) -> แสดงเหตุผลใน dialog และไม่ย้ายหน้า", async () => {
    authState.role = "FirmwareEngineer";
    firmwareState.data = baseFirmware;
    routerMock.push.mockClear();
    const { ApiError } = await import("@/lib/api");
    deleteFirmwareMock.mockRejectedValue(
      new ApiError("ลบ Firmware นี้ไม่ได้ เพราะมีกล่องกำลังรัน DEV-0001", 409),
    );
    const user = userEvent.setup();

    render(<FirmwareDetailView firmwareId="fw-1" />);
    await user.click(screen.getByRole("button", { name: "ลบ Firmware นี้" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันลบ" }));

    expect(await screen.findByText(/DEV-0001/)).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});
