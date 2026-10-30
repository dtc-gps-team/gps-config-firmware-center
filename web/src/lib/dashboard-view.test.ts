import { describe, expect, it } from "vitest";

import { dashboardView } from "./dashboard-view";
import {
  oldestIso,
  sortQueue,
  waitingLabel,
  type QueueItem,
} from "./dashboard-queue";
import {
  activeRollouts,
  capFleetDots,
  fleetDots,
  rolloutsAwaitingRelease,
  silentDevices,
} from "./dashboard-metrics";
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

  it("นับเฉพาะเครื่องออฟไลน์ที่ขาดการติดต่อเกินเกณฑ์ เรียงเงียบนานสุดก่อน", () => {
    const central = [
      { deviceId: "A", online: false, lastSeenAt: ago(30) },
      { deviceId: "B", online: false, lastSeenAt: ago(60) },
      { deviceId: "C", online: false, lastSeenAt: ago(2) },
      { deviceId: "D", online: true, lastSeenAt: ago(1) },
    ];
    const result = silentDevices(devices, central, 24 * HOUR, NOW);
    expect(result.map((d) => d.deviceId)).toEqual(["B", "A"]);
  });

  it("เครื่องที่ไม่เคยรายงานขาดการติดต่อนานที่สุด และเครื่องที่ Server กลางไม่รู้จักไม่นับ", () => {
    const central = [
      { deviceId: "A", online: false, lastSeenAt: ago(48) },
      { deviceId: "B", online: false, lastSeenAt: null },
    ];
    const result = silentDevices(devices, central, 24 * HOUR, NOW);
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

describe("sortQueue", () => {
  const item = (key: string, tone: QueueItem["tone"], count: number): QueueItem => ({
    key,
    tone,
    title: key,
    count,
  });

  it("ตัดงานที่ไม่มี และเรียงผิดปกติ → ต้องตัดสินใจ → รับทราบ ลำดับเดิมคงไว้ในโทนเดียวกัน", () => {
    const sorted = sortQueue([
      item("info", "info", 2),
      item("warn-1", "warning", 1),
      item("empty", "danger", 0),
      item("danger", "danger", 3),
      item("warn-2", "warning", 4),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["danger", "warn-1", "warn-2", "info"]);
  });
});

describe("waitingLabel / oldestIso", () => {
  it("แปลงเวลาที่ค้างเป็นข้อความ", () => {
    expect(waitingLabel(ago(0.2), NOW)).toBe("ค้างมาไม่ถึงชั่วโมง");
    expect(waitingLabel(ago(5), NOW)).toBe("ค้างมา 5 ชั่วโมง");
    expect(waitingLabel(ago(50), NOW)).toBe("ค้างมา 2 วัน");
    expect(waitingLabel(undefined, NOW)).toBeUndefined();
  });

  it("หาเวลาเก่าสุดโดยข้ามค่าว่าง/ไม่ถูกต้อง", () => {
    expect(oldestIso([ago(1), null, "x", ago(9)])).toBe(ago(9));
    expect(oldestIso([])).toBeUndefined();
  });
});

describe("dashboardView ต่อ Role", () => {
  it("role ที่ไม่มี campaign:Read ไม่มีแผงที่พึ่ง Campaign และ health ไม่มี deploy", () => {
    for (const role of ["FirmwareEngineer", "QAEngineer"]) {
      const v = dashboardView(role);
      expect(v.rows.flat().map((p) => p.id)).not.toContain("rollouts");
      expect(v.health).not.toContain("deploy");
    }
  });

  it("role ที่เข้า Audit Log ไม่ได้ไม่มีแผงกิจกรรมล่าสุด", () => {
    for (const role of ["ConfigEngineer", "FirmwareEngineer", "QAEngineer"]) {
      expect(dashboardView(role).rows.flat().map((p) => p.id)).not.toContain("activity");
    }
  });

  it("แต่ละ role มีคิวงานตามหน้าที่ของตัวเอง", () => {
    expect(dashboardView("Operation").queue).toBe("operation");
    expect(dashboardView("ConfigEngineer").queue).toBe("configEngineer");
    expect(dashboardView("QAEngineer").queue).toBe("qa");
    expect(dashboardView("FirmwareEngineer").queue).toBe("firmwareEngineer");
    expect(dashboardView("ST").queue).toBe("field");
    expect(dashboardView("Auditor").queue).toBeNull();
    expect(dashboardView("SuperAdmin").queue).toBeNull();
  });

  it("แต่ละแถวผลรวม span เป็น 12", () => {
    for (const role of ["Operation", "ST", "ConfigEngineer", "QAEngineer", "Auditor", "Admin"]) {
      for (const row of dashboardView(role).rows) {
        expect(row.reduce((n, p) => n + p.span, 0)).toBe(12);
      }
    }
  });

  it("role ที่ไม่รู้จักได้มุมมองอ่านอย่างเดียว ไม่มีคิว", () => {
    expect(dashboardView(null).queue).toBeNull();
    expect(dashboardView("Whatever").queue).toBeNull();
  });
});

describe("fleetDots / capFleetDots", () => {
  const devices = ["A", "B", "C", "D"].map((deviceId) => ({
    deviceId,
    deviceModel: "BB-200",
  }));
  const c = (
    deviceId: string,
    online: boolean,
    desired: number | null,
    reported: number | null,
  ) => ({
    deviceId,
    online,
    lastSeenAt: null,
    desiredConfigVersion: desired,
    reportedConfigVersion: reported,
  });

  it("ระบุสถานะต่อเครื่อง และเรียงเครื่องที่ต้องสนใจขึ้นก่อน", () => {
    const dots = fleetDots(devices, [
      c("A", true, 1, 1), // ปกติ
      c("B", false, 1, 1), // ออฟไลน์
      c("C", true, 2, 1), // Config ไม่ตรง
      // D ไม่อยู่ใน Server กลาง
    ]);
    expect(dots.map((d) => [d.deviceId, d.status, d.drift])).toEqual([
      ["C", "online", true],
      ["B", "offline", false],
      ["D", "unknown", false],
      ["A", "online", false],
    ]);
  });

  it("Config ไม่ตรงนับตามเกณฑ์เดียวกับ configDriftCount (ไม่นับเครื่องที่ยังไม่ตั้งเป้า)", () => {
    const dots = fleetDots(devices, [c("A", true, null, 3), c("B", true, 2, 2)]);
    expect(dots.every((d) => !d.drift)).toBe(true);
  });

  it("ไม่เกินเพดาน: วาดทุกเครื่อง", () => {
    const dots = fleetDots(devices, [c("A", true, 1, 1)]);
    expect(capFleetDots(dots, 10)).toEqual({
      shown: dots,
      hiddenNormal: 0,
      hiddenAbnormal: 0,
    });
  });

  it("เกินเพดาน: วาดเฉพาะเครื่องที่ต้องสนใจ ที่เหลือสรุปเป็นตัวเลข", () => {
    const dots = fleetDots(devices, [
      c("A", true, 1, 1),
      c("B", true, 1, 1),
      c("C", false, 1, 1),
      c("D", true, 1, 1),
    ]);
    const view = capFleetDots(dots, 3);
    expect(view.shown.map((d) => d.deviceId)).toEqual(["C"]);
    expect(view.hiddenNormal).toBe(3);
    expect(view.hiddenAbnormal).toBe(0);
  });

  it("เกินเพดานและผิดปกติเองก็เกินเพดาน: นับส่วนที่ไม่ได้วาด", () => {
    const dots = fleetDots(devices, devices.map((d) => c(d.deviceId, false, 1, 1)));
    const view = capFleetDots(dots, 2);
    expect(view.shown).toHaveLength(2);
    expect(view.hiddenAbnormal).toBe(2);
    expect(view.hiddenNormal).toBe(0);
  });
});
