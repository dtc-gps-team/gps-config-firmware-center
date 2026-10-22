import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RolloutImpactCard } from "./rollout-impact-card";
import type { Incident } from "@/lib/incident-api";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-r1",
    title: "Rollout หยุดอัตโนมัติ: อัปเดต GT06N",
    description: null,
    severity: "high",
    status: "open",
    relatedConfigId: null,
    relatedFirmwareId: null,
    source: "rollout-failure",
    metadata: {
      kind: "auto-pause",
      campaignId: "c-1",
      rolloutId: "r-9",
      failureCount: 25,
      targetCount: 100,
      skippedCount: 5,
      failedDeviceIds: Array.from(
        { length: 20 },
        (_, i) => `DEV-${String(i + 1).padStart(4, "0")}`,
      ),
      sampleErrors: ["หมดเวลารอผล", "checksum ไม่ตรง"],
    },
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

describe("RolloutImpactCard", () => {
  it("แสดงจำนวนเครื่อง รายการเครื่องที่ล้มเหลวทั้ง 20 เครื่องที่เก็บไว้ และจำนวนที่เกิน", () => {
    render(<RolloutImpactCard incident={incident()} />);

    expect(
      screen.getByText("ล้มเหลว 25 จาก 100 เครื่อง (25%)"),
    ).toBeInTheDocument();
    expect(screen.getByText("ข้ามเพราะออฟไลน์ 5 เครื่อง")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^DEV-/ })).toHaveLength(20);
    expect(screen.getByText(/และอีก 5 เครื่อง/)).toBeInTheDocument();
  });

  it("รหัสเครื่องเป็นลิงก์ไปหน้าอุปกรณ์", () => {
    render(<RolloutImpactCard incident={incident()} />);

    expect(screen.getByRole("link", { name: "DEV-0003" })).toHaveAttribute(
      "href",
      "/devices/DEV-0003",
    );
  });

  it("แสดงข้อผิดพลาดตัวอย่าง", () => {
    render(<RolloutImpactCard incident={incident()} />);

    expect(screen.getByText("หมดเวลารอผล")).toBeInTheDocument();
    expect(screen.getByText("checksum ไม่ตรง")).toBeInTheDocument();
  });

  it("มีลิงก์ไปหน้า Rollout ต้นทาง", () => {
    render(<RolloutImpactCard incident={incident()} />);

    expect(
      screen.getByRole("link", { name: /ดู Rollout ต้นทาง/ }),
    ).toHaveAttribute("href", "/campaigns/c-1/rollouts/r-9");
  });

  it("เครื่องที่ล้มเหลวไม่เกินที่เก็บไว้: ไม่มี 'และอีก'", () => {
    render(
      <RolloutImpactCard
        incident={incident({
          metadata: {
            kind: "completed-with-failures",
            failureCount: 2,
            targetCount: 10,
            failedDeviceIds: ["DEV-0001", "DEV-0002"],
          },
        })}
      />,
    );

    expect(screen.queryByText(/และอีก/)).not.toBeInTheDocument();
    expect(screen.queryByText("ข้อผิดพลาดตัวอย่าง")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /ดู Rollout ต้นทาง/ }),
    ).not.toBeInTheDocument();
  });

  it("Incident ที่ไม่ใช่ Rollout: ไม่แสดงการ์ดนี้เลย", () => {
    const { container } = render(
      <RolloutImpactCard
        incident={incident({
          source: "config-sync-writer",
          metadata: { attempts: 3 },
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
