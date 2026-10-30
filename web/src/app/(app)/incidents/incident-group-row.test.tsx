import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Incident } from "@/lib/incident-api";
import { groupIncidents } from "@/lib/incident-group";
import { IncidentGroupRow } from "./incident-group-row";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
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

function make(id: string, minute: number): Incident {
  return {
    id,
    title: "Rollout จบแต่มีเครื่องที่ไม่สำเร็จ",
    description: null,
    severity: "high",
    status: "open",
    relatedConfigId: null,
    relatedFirmwareId: null,
    source: "rollout-failure",
    metadata: { rolloutId: "r1", failureCount: 1, targetCount: 1 },
    deviceId: null,
    reportedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: `2026-10-26T04:0${minute}:00Z`,
    updatedAt: `2026-10-26T04:0${minute}:00Z`,
  };
}

function renderGroup(items: Incident[], onStale = vi.fn()) {
  const [group] = groupIncidents(items);
  render(
    <ul>
      <IncidentGroupRow
        group={group}
        reporterName={null}
        onDecided={vi.fn()}
        onStale={onStale}
      />
    </ul>,
  );
  return onStale;
}

describe("IncidentGroupRow", () => {
  beforeEach(() => decideIncident.mockReset());

  it("เกิดซ้ำ: บอกจำนวนครั้ง และขยายดูทีละครั้งได้", async () => {
    const user = userEvent.setup();
    renderGroup([make("a", 1), make("b", 2), make("c", 3)]);

    expect(screen.getByText("เกิด 3 ครั้ง")).toBeInTheDocument();
    expect(
      screen.queryAllByRole("link", { name: "ดูรายละเอียด" }),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /ดูทั้ง 3 ครั้ง/ }));

    expect(screen.getAllByRole("link", { name: "ดูรายละเอียด" })).toHaveLength(
      3,
    );
  });

  it("ปิดทั้งกลุ่ม: ต้องพิมพ์ CLOSE และกรอกหมายเหตุ แล้วยิงปิดทุกรายการ", async () => {
    const user = userEvent.setup();
    decideIncident.mockResolvedValue({});
    const onStale = renderGroup([make("a", 1), make("b", 2), make("c", 3)]);

    await user.click(screen.getByRole("button", { name: "ปิดทั้ง 3 รายการ" }));
    const confirm = screen.getByRole("button", { name: "ปิด 3 รายการ" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("หมายเหตุ"), "ตรวจแล้ว ไม่กระทบ");
    await user.type(
      screen.getByRole("textbox", { name: /พิมพ์ CLOSE/ }),
      "CLOSE",
    );
    await user.click(confirm);

    await waitFor(() => expect(decideIncident).toHaveBeenCalledTimes(3));
    expect(decideIncident).toHaveBeenCalledWith("tok", "c", {
      outcome: "resolve",
      note: "ตรวจแล้ว ไม่กระทบ",
    });
    await waitFor(() => expect(onStale).toHaveBeenCalled());
  });

  it("ไม่ได้เกิดซ้ำ: ไม่มีปุ่มปิดทั้งกลุ่ม ใช้ปุ่มปิดตามปกติ", () => {
    renderGroup([make("a", 1)]);

    expect(screen.queryByText(/เกิด \d+ ครั้ง/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ปิดทั้ง/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ปิด Incident" }),
    ).toBeInTheDocument();
  });
});
