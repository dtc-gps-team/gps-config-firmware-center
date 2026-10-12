import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { FirmwareDetailView } from "./firmware-detail-view";
import type { Firmware } from "@/lib/firmware-api";

vi.mock("@/components/auth/auth-provider", () => ({
  // Auditor ไม่มีสิทธิ์พิเศษอะไรเลย (แก้/อนุมัติ/ทดสอบ) ตัดทุก panel ออก
  // กันชนกับ InfoRow ที่ทดสอบอยู่
  useAuth: () => ({ session: { accessToken: "tok", role: "Auditor" } }),
}));

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
  uploadedBy: "fw-eng-1",
  uploadedAt: "2026-01-01T00:00:00Z",
  approvalStatus: "pending_review",
  approvedBy: null,
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
