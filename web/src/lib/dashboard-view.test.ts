import { describe, expect, it } from "vitest";

import {
  activeRollouts,
  rolloutsAwaitingRelease,
  silentDevices,
} from "./dashboard-metrics";
import { dashboardView } from "./dashboard-view";
import type { CampaignRollout } from "./campaign-api";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

const rollout = (over: Partial<CampaignRollout>) =>
  ({
    id: "r",
    status: "approved",
    createdAt: ago(100),
    approvedAt: null,
    ...over,
  }) as CampaignRollout;

describe("silentDevices", () => {
  const devices = ["A", "B", "C", "D", "E"].map((deviceId) => ({
    deviceId,
    deviceModel: "BB-200",
  }));

  it("นับเฉพาะเครื่องออฟไลน์ที่เงียบเกินเกณฑ์ เรียงเงียบนานสุดก่อน", () => {
    const central = [
      { deviceId: "A", online: false, lastSeenAt: ago(30) },
      { deviceId: "B", online: false, lastSeenAt: ago(60) },
      { deviceId: "C", online: false, lastSeenAt: ago(2) }, // เพิ่งหาย ยังไม่เกินเกณฑ์
      { deviceId: "D", online: true, lastSeenAt: ago(1) },
    ];
    const result = silentDevices(devices, central, 24 * HOUR, NOW);
    expect(result.map((d) => d.deviceId)).toEqual(["B", "A"]);
  });

  it("เครื่องที่ไม่เคยรายงานเงียบที่สุด และเครื่องที่ Server กลางไม่รู้จักไม่นับ", () => {
    const central = [
      { deviceId: "A", online: false, lastSeenAt: ago(48) },
      { deviceId: "B", online: false, lastSeenAt: null },
    ];
    const result = silentDevices(devices, central, 24 * HOUR, NOW);
    // E ไม่อยู่ใน Server กลาง จึงไม่ถูกนับ
    expect(result.map((d) => d.deviceId)).toEqual(["B", "A"]);
  });
});

describe("rollouts", () => {
  it("รอปล่อย: เฉพาะ approved เรียงที่อนุมัติก่อนขึ้นก่อน", () => {
    const result = rolloutsAwaitingRelease([
      rollout({ id: "new", approvedAt: ago(1) }),
      rollout({ id: "old", approvedAt: ago(30) }),
      rollout({ id: "active", status: "active" }),
    ]);
    expect(result.map((r) => r.id)).toEqual(["old", "new"]);
  });

  it("กำลังทำงาน: เฉพาะ active", () => {
    const result = activeRollouts([
      rollout({ id: "a", status: "active" }),
      rollout({ id: "p", status: "paused" }),
    ]);
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("dashboardView ต่อ Role", () => {
  it("role ที่ไม่มี campaign:Read ไม่มีแผงที่พึ่ง Campaign", () => {
    for (const role of ["FirmwareEngineer", "QAEngineer"]) {
      const v = dashboardView(role);
      expect(v.summary).toEqual([]);
      expect(v.risk).toEqual(["incident"]);
      expect(v.stats).not.toContain("campaigns");
    }
  });

  it("role ที่เข้า Audit Log ไม่ได้ไม่มีแผงกิจกรรมล่าสุด", () => {
    for (const role of ["ConfigEngineer", "FirmwareEngineer", "QAEngineer"]) {
      const v = dashboardView(role);
      const ids = [...v.focus, ...v.lower].map((p) => p.id);
      expect(ids).not.toContain("activity");
    }
  });

  it("Operation เห็น Rollout รอปล่อย, ConfigEngineer เห็น Config ของตัวเอง", () => {
    expect(dashboardView("Operation").summary.map((p) => p.id)).toContain("rollouts");
    expect(dashboardView("ConfigEngineer").focus.map((p) => p.id)).toContain("myConfigs");
    expect(dashboardView("QAEngineer").focus.map((p) => p.id)).toContain("firmwareQueue");
  });

  it("role ที่ไม่รู้จักได้มุมมองอ่านอย่างเดียว ไม่มีแผงเฉพาะ role", () => {
    expect(dashboardView(null).focus).toEqual([]);
    expect(dashboardView("Whatever").focus).toEqual([]);
  });
});
