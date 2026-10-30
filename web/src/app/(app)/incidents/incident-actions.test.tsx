import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IncidentActions } from "./incident-actions";
import { ApiError } from "@/lib/api";
import type { Incident } from "@/lib/incident-api";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const auth = vi.hoisted(() => ({ role: "Operation" }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: auth.role } }),
}));

const decideIncident = vi.fn();
const retryIncidentConfigSync = vi.fn();
vi.mock("@/lib/incident-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/incident-api")>(
      "@/lib/incident-api",
    );
  return {
    ...actual,
    decideIncident: (...args: unknown[]) => decideIncident(...args),
    retryIncidentConfigSync: (...args: unknown[]) =>
      retryIncidentConfigSync(...args),
  };
});

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    title: "เขียน Config เข้าระบบเดิมไม่สำเร็จ (v1)",
    description: null,
    severity: "high",
    status: "investigating",
    relatedConfigId: "cfg-1",
    relatedFirmwareId: null,
    source: "config-sync-writer",
    metadata: { versionNumber: 1, attempts: 3, lastError: "ETIMEDOUT" },
    deviceId: null,
    reportedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-10-12T08:00:00Z",
    updatedAt: "2026-10-12T08:00:00Z",
    ...overrides,
  };
}

function renderActions(i: Incident) {
  const onDecided = vi.fn();
  const onStale = vi.fn();
  render(
    <IncidentActions incident={i} onDecided={onDecided} onStale={onStale} />,
  );
  return { onDecided, onStale };
}

describe("IncidentActions: Incident ที่ระบบสร้างเอง", () => {
  beforeEach(() => {
    auth.role = "Operation";
    decideIncident.mockReset();
    retryIncidentConfigSync.mockReset();
  });

  it("เขียน Config ไม่สำเร็จที่ยังเปิดอยู่: Operation เห็นทั้ง 'ลองเขียนใหม่' และ 'ปิด Incident'", () => {
    renderActions(incident({ status: "open" }));

    expect(
      screen.getByRole("button", { name: "ลองเขียนใหม่" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ปิด Incident" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ดูได้อย่างเดียว")).not.toBeInTheDocument();
  });

  it("Rollout ล้มเหลว: เห็นเฉพาะ 'ปิด Incident' ไม่มี 'ลองเขียนใหม่'", () => {
    renderActions(
      incident({
        source: "rollout-failure",
        relatedConfigId: null,
        metadata: { kind: "completed-with-failures" },
      }),
    );

    expect(
      screen.getByRole("button", { name: "ปิด Incident" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ลองเขียนใหม่" }),
    ).not.toBeInTheDocument();
  });

  it("เขียน Config แต่ข้อมูลไม่พอให้เขียนซ้ำ (ไม่มีเวอร์ชัน): ปิดได้ แต่ไม่มี 'ลองเขียนใหม่'", () => {
    renderActions(incident({ metadata: null }));

    expect(
      screen.getByRole("button", { name: "ปิด Incident" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ลองเขียนใหม่" }),
    ).not.toBeInTheDocument();
  });

  it.each(["resolved", "dismissed", "rolled_back"] as const)(
    "ปิดแล้ว (%s): ไม่มีปุ่มใดเลย เห็นแค่ 'ดูได้อย่างเดียว'",
    (status) => {
      renderActions(incident({ status }));

      expect(
        screen.queryByRole("button", { name: "ปิด Incident" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "ลองเขียนใหม่" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("ดูได้อย่างเดียว")).toBeInTheDocument();
    },
  );

  it("Role ที่ไม่ใช่ Operation: ไม่เห็นปุ่มปิดหรือลองเขียนใหม่", () => {
    auth.role = "Admin";
    renderActions(incident());

    expect(
      screen.queryByRole("button", { name: "ปิด Incident" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ลองเขียนใหม่" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("ดูได้อย่างเดียว")).toBeInTheDocument();
  });

  it("กด 'ลองเขียนใหม่': เรียก API ด้วย id ของ Incident แล้วสั่งให้ดึงรายการใหม่", async () => {
    const user = userEvent.setup();
    retryIncidentConfigSync.mockResolvedValue(
      incident({ status: "investigating" }),
    );
    const { onStale } = renderActions(incident({ status: "open" }));

    await user.click(screen.getByRole("button", { name: "ลองเขียนใหม่" }));

    await waitFor(() =>
      expect(retryIncidentConfigSync).toHaveBeenCalledWith("tok", "inc-1"),
    );
    await waitFor(() => expect(onStale).toHaveBeenCalled());
  });

  it("'ลองเขียนใหม่' ได้ 409 (ถูกปิดไปก่อน): ไม่ throw และดึงรายการใหม่", async () => {
    const user = userEvent.setup();
    retryIncidentConfigSync.mockRejectedValue(
      new ApiError("Incident นี้ปิดไปแล้ว", 409),
    );
    const { onStale } = renderActions(incident({ status: "open" }));

    await user.click(screen.getByRole("button", { name: "ลองเขียนใหม่" }));

    await waitFor(() => expect(onStale).toHaveBeenCalled());
  });

  it("กำลังลองเขียนอยู่ (investigating): ไม่มีปุ่ม 'ลองเขียนใหม่' ให้กดซ้ำ มีปุ่มที่กดไม่ได้บอกว่ากำลังรอผล", () => {
    renderActions(incident({ status: "investigating" }));

    expect(
      screen.queryByRole("button", { name: "ลองเขียนใหม่" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "กำลังลองเขียน…" }),
    ).toBeDisabled();
    // ยังปิด Incident ด้วยมือได้ตามปกติ
    expect(
      screen.getByRole("button", { name: "ปิด Incident" }),
    ).toBeInTheDocument();
  });

  it("ปิด Incident: เลือกผลและกรอกหมายเหตุ แล้วส่ง resolve ไปที่ decide (ไม่มีตัวเลือกส่งต่อเป็น Campaign)", async () => {
    const user = userEvent.setup();
    decideIncident.mockResolvedValue({
      ...incident({ status: "resolved" }),
      device: null,
    });
    const { onDecided } = renderActions(incident());

    await user.click(screen.getByRole("button", { name: "ปิด Incident" }));
    expect(screen.queryByText("ส่งต่อเป็น Campaign")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/แก้แล้ว/));
    await user.type(screen.getByLabelText("หมายเหตุ"), "เขียนเข้าระบบเองแล้ว");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    await waitFor(() =>
      expect(decideIncident).toHaveBeenCalledWith("tok", "inc-1", {
        outcome: "resolve",
        note: "เขียนเข้าระบบเองแล้ว",
      }),
    );
    await waitFor(() =>
      expect(onDecided).toHaveBeenCalledWith(
        expect.objectContaining({ status: "resolved" }),
        "resolve",
      ),
    );
  });

  it("ปิด Incident โดยไม่กรอกหมายเหตุ: ปุ่มยืนยันกดไม่ได้", async () => {
    const user = userEvent.setup();
    renderActions(incident());

    await user.click(screen.getByRole("button", { name: "ปิด Incident" }));
    await user.click(screen.getByLabelText(/ไม่ต้องดำเนินการ/));

    expect(screen.getByRole("button", { name: "ยืนยัน" })).toBeDisabled();
  });
});

describe("IncidentActions: Field Report ไม่เปลี่ยนพฤติกรรม", () => {
  beforeEach(() => {
    auth.role = "Operation";
  });

  it("Field Report ที่ open: ยังเห็นปุ่ม 'ตัดสินใจ' (ไม่ใช่ 'ปิด Incident') และไม่มี 'ลองเขียนใหม่'", () => {
    renderActions(
      incident({
        source: "field-report",
        status: "open",
        relatedConfigId: null,
        metadata: null,
        deviceId: "DEV-0101",
        reportedBy: "user-st",
      }),
    );

    expect(
      screen.getByRole("button", { name: "ตัดสินใจ" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ปิด Incident" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ลองเขียนใหม่" }),
    ).not.toBeInTheDocument();
  });
});
