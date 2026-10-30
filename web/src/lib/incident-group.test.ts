import { describe, expect, it } from "vitest";

import type { Incident } from "@/lib/incident-api";
import { groupIncidents, severityLabel } from "./incident-group";

function make(overrides: Partial<Incident>): Incident {
  return {
    id: "i",
    title: "Rollout จบแต่มีเครื่องที่ไม่สำเร็จ",
    description: null,
    severity: "high",
    status: "open",
    relatedConfigId: null,
    relatedFirmwareId: null,
    source: "rollout-failure",
    metadata: { rolloutId: "r1" },
    deviceId: null,
    reportedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-10-26T04:00:00Z",
    updatedAt: "2026-10-26T04:00:00Z",
    ...overrides,
  };
}

describe("groupIncidents", () => {
  it("รวมเรื่องเดียวกัน (หัวข้อ + Rollout เดียวกัน) เป็นกลุ่มเดียว เรียงล่าสุดก่อน", () => {
    const groups = groupIncidents([
      make({ id: "a", createdAt: "2026-10-26T04:00:00Z" }),
      make({ id: "b", createdAt: "2026-10-26T06:00:00Z" }),
      make({ id: "c", createdAt: "2026-10-26T05:00:00Z" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(groups[0].latest.id).toBe("b");
  });

  it("คนละ Rollout หรือคนละอุปกรณ์ไม่รวมกัน", () => {
    const groups = groupIncidents([
      make({ id: "a", metadata: { rolloutId: "r1" } }),
      make({ id: "b", metadata: { rolloutId: "r2" } }),
      make({ id: "c", source: "field-report", metadata: null, deviceId: "D1" }),
      make({ id: "d", source: "field-report", metadata: null, deviceId: "D2" }),
    ]);

    expect(groups).toHaveLength(4);
  });

  it("เรียงกลุ่มตามความรุนแรงสูงสุดก่อน แล้วค่อยล่าสุด", () => {
    const groups = groupIncidents([
      make({
        id: "low-new",
        title: "ก",
        severity: "low",
        createdAt: "2026-10-27T00:00:00Z",
      }),
      make({
        id: "crit-old",
        title: "ข",
        severity: "critical",
        createdAt: "2026-10-20T00:00:00Z",
      }),
      make({
        id: "high-new",
        title: "ค",
        severity: "high",
        createdAt: "2026-10-26T00:00:00Z",
      }),
      make({
        id: "high-old",
        title: "ง",
        severity: "high",
        createdAt: "2026-10-25T00:00:00Z",
      }),
    ]);

    expect(groups.map((g) => g.latest.id)).toEqual([
      "crit-old",
      "high-new",
      "high-old",
      "low-new",
    ]);
  });

  it("ป้ายความรุนแรงเป็นไทย", () => {
    expect(severityLabel("critical")).toBe("วิกฤต");
    expect(severityLabel("low")).toBe("ต่ำ");
  });
});
