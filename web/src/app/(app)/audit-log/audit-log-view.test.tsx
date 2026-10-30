import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuditLogView } from "./audit-log-view";

const hook = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    isReady: true,
    session: { role: "Auditor", accessToken: "tok" },
  }),
}));
vi.mock("@/hooks/use-audit-logs", () => ({
  useAuditLogs: (filters: Record<string, unknown>) => {
    hook.calls.push(filters);
    return {
      data: [],
      total: 0,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

function lastFilters(): Record<string, unknown> {
  return hook.calls[hook.calls.length - 1];
}

describe("AuditLogView: filter วันที่และชื่อผู้ทำรายการ", () => {
  beforeEach(() => {
    hook.calls.length = 0;
    window.history.replaceState(null, "", "/audit-log");
  });

  it("เริ่มต้นไม่กรองอะไร และไม่มีปุ่มล้างตัวกรอง", () => {
    render(<AuditLogView />);

    expect(lastFilters()).toMatchObject({
      from: undefined,
      to: undefined,
      actorName: undefined,
      enabled: true,
      page: 1,
    });
    expect(
      screen.queryByRole("button", { name: "ล้างตัวกรอง" }),
    ).not.toBeInTheDocument();
  });

  it("เลือกวันเดียว: ส่งช่วงทั้งวันตามเวลาไทย", () => {
    render(<AuditLogView />);

    fireEvent.change(screen.getByLabelText("ตั้งแต่วันที่"), {
      target: { value: "2026-10-14" },
    });
    fireEvent.change(screen.getByLabelText("ถึงวันที่"), {
      target: { value: "2026-10-14" },
    });

    expect(lastFilters()).toMatchObject({
      from: "2026-10-13T17:00:00.000Z",
      to: "2026-10-14T16:59:59.999Z",
      enabled: true,
    });
  });

  it("วันเริ่มต้นมากกว่าวันสิ้นสุด: แสดงข้อความและไม่ยิง request", () => {
    render(<AuditLogView />);

    fireEvent.change(screen.getByLabelText("ตั้งแต่วันที่"), {
      target: { value: "2026-10-15" },
    });
    fireEvent.change(screen.getByLabelText("ถึงวันที่"), {
      target: { value: "2026-10-14" },
    });

    expect(
      screen.getByText("วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด"),
    ).toBeInTheDocument();
    expect(lastFilters()).toMatchObject({ enabled: false });
  });

  it("พิมพ์ชื่อผู้ทำรายการ: ส่ง actorName (ตัดช่องว่าง) หลัง debounce", async () => {
    const user = userEvent.setup();
    render(<AuditLogView />);

    await user.type(screen.getByLabelText("ผู้ทำรายการ"), " สมชาย ");

    await waitFor(() =>
      expect(lastFilters()).toMatchObject({ actorName: "สมชาย" }),
    );
  });

  it("ล้างตัวกรอง: คืนทุกค่ากลับเป็นค่าเริ่มต้น", async () => {
    const user = userEvent.setup();
    render(<AuditLogView />);
    fireEvent.change(screen.getByLabelText("ตั้งแต่วันที่"), {
      target: { value: "2026-10-14" },
    });

    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));

    expect(lastFilters()).toMatchObject({
      from: undefined,
      to: undefined,
      actorName: undefined,
    });
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveValue("");
  });

  it("ตัวกรองถูกเก็บใน URL และอ่านกลับเมื่อเปิดลิงก์ตรง", () => {
    window.history.replaceState(null, "", "/audit-log?actor=%E0%B8%AA&module=config&page=3");
    render(<AuditLogView />);

    expect(lastFilters()).toMatchObject({ auditModule: "config", page: 3 });
    fireEvent.change(screen.getByLabelText("ตั้งแต่วันที่"), {
      target: { value: "2026-10-14" },
    });
    expect(window.location.search).toContain("from=2026-10-14");
    expect(window.location.search).not.toContain("page=");
  });

  it("ไม่มีรายการ: ปุ่มส่งออก CSV ถูกปิด", () => {
    render(<AuditLogView />);
    expect(screen.getByRole("button", { name: /ส่งออก CSV/ })).toBeDisabled();
  });
});
