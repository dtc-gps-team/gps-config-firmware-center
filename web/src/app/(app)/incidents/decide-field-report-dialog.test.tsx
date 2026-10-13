import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DecideFieldReportDialog } from "./decide-field-report-dialog";
import { ApiError } from "@/lib/api";
import type { Incident } from "@/lib/incident-api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const decideIncident = vi.fn();
vi.mock("@/lib/incident-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/incident-api")>(
      "@/lib/incident-api",
    );
  return {
    ...actual,
    decideIncident: (...args: unknown[]) => decideIncident(...args),
  };
});

const incident: Incident = {
  id: "inc-1",
  title: "ปุ่ม SOS กดแล้วไม่ส่งแจ้งเตือน",
  description: null,
  severity: "critical",
  status: "open",
  relatedConfigId: null,
  relatedFirmwareId: null,
  source: "field-report",
  metadata: null,
  deviceId: "DEV-0103",
  reportedBy: "user-st",
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: "2026-10-12T08:00:00Z",
  updatedAt: "2026-10-12T08:00:00Z",
};

async function openDialog() {
  const user = userEvent.setup();
  const onDecided = vi.fn();
  const onStale = vi.fn();
  render(
    <DecideFieldReportDialog
      incident={incident}
      onDecided={onDecided}
      onStale={onStale}
    />,
  );
  await user.click(screen.getByRole("button", { name: "ตัดสินใจ" }));
  return { user, onDecided, onStale };
}

describe("DecideFieldReportDialog", () => {
  beforeEach(() => {
    // ต้องใช้ block ไม่คืนค่า: vitest ถือว่าฟังก์ชันที่ beforeEach คืนมาเป็น
    // teardown แล้วเรียกหลังจบเทสต์ (mockReset คืน mock เอง จึงถูกเรียกซ้ำ)
    decideIncident.mockReset();
  });

  it("แสดง 3 ทางเลือกด้วยคำว่า 'ไม่ต้องดำเนินการ' (ไม่ใช่ 'ไม่ใช่ปัญหา')", async () => {
    await openDialog();

    expect(screen.getByLabelText(/แก้แล้ว/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ไม่ต้องดำเนินการ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ส่งต่อเป็น Campaign/)).toBeInTheDocument();
    expect(screen.queryByText("ไม่ใช่ปัญหา")).not.toBeInTheDocument();
  });

  it("ปุ่มยืนยันกดไม่ได้จนกว่าจะเลือกทางเลือกและกรอกหมายเหตุ", async () => {
    const { user } = await openDialog();
    const confirm = screen.getByRole("button", { name: "ยืนยัน" });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByLabelText(/แก้แล้ว/));
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("หมายเหตุ"), "   ");
    expect(confirm).toBeDisabled(); // ช่องว่างล้วนไม่นับ

    await user.type(screen.getByLabelText("หมายเหตุ"), "ขันสายใหม่แล้ว");
    expect(confirm).toBeEnabled();
  });

  it("ส่ง outcome และ note (ตัดช่องว่างหัวท้าย) ไปที่ API แล้วเรียก onDecided", async () => {
    decideIncident.mockResolvedValue({ ...incident, status: "resolved" });
    const { user, onDecided } = await openDialog();

    await user.click(screen.getByLabelText(/แก้แล้ว/));
    await user.type(screen.getByLabelText("หมายเหตุ"), "  ขันสายใหม่แล้ว  ");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(decideIncident).toHaveBeenCalledWith("tok", "inc-1", {
      outcome: "resolve",
      note: "ขันสายใหม่แล้ว",
    });
    expect(onDecided.mock.calls[0][1]).toBe("resolve");
  });

  it("ทางเลือก 'ไม่ต้องดำเนินการ' ส่ง outcome dismiss", async () => {
    decideIncident.mockResolvedValue({ ...incident, status: "dismissed" });
    const { user, onDecided } = await openDialog();

    await user.click(screen.getByLabelText(/ไม่ต้องดำเนินการ/));
    await user.type(screen.getByLabelText("หมายเหตุ"), "ซ้ำกับรายการเดิม");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(decideIncident).toHaveBeenCalledWith("tok", "inc-1", {
      outcome: "dismiss",
      note: "ซ้ำกับรายการเดิม",
    });
  });

  it("409 มีคนตัดสินไปก่อน: แสดงข้อความของ backend, ไม่เรียก onDecided, และสั่งรีเฟรชรายการ", async () => {
    // ใช้ mockImplementation แบบ lazy: mockRejectedValue สร้าง promise ที่ reject
    // ทันที ก่อนที่ component จะ await ทำให้ถูกนับเป็น unhandled rejection
    decideIncident.mockImplementation(() =>
      Promise.reject(
        new ApiError(
          "Incident นี้ถูกตัดสินใจไปแล้ว (สถานะปัจจุบัน: resolved)",
          409,
        ),
      ),
    );
    const { user, onDecided, onStale } = await openDialog();

    await user.click(screen.getByLabelText(/แก้แล้ว/));
    await user.type(screen.getByLabelText("หมายเหตุ"), "ขันสายแล้ว");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    expect(await screen.findByText(/ถูกตัดสินใจไปแล้ว/)).toBeInTheDocument();
    expect(onDecided).not.toHaveBeenCalled();
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("error อื่น: แสดงข้อความ ไม่สั่งรีเฟรช และกดยืนยันซ้ำได้", async () => {
    decideIncident.mockImplementation(async () => {
      throw new ApiError("เซิร์ฟเวอร์ผิดพลาด", 500);
    });
    const { user, onStale } = await openDialog();

    await user.click(screen.getByLabelText(/ส่งต่อเป็น Campaign/));
    await user.type(screen.getByLabelText("หมายเหตุ"), "ต้องอัปเดต Firmware");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    expect(await screen.findByText("เซิร์ฟเวอร์ผิดพลาด")).toBeInTheDocument();
    expect(onStale).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ยืนยัน" })).toBeEnabled();
  });
});
