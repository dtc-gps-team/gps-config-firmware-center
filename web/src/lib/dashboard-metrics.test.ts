import { describe, expect, it } from "vitest";

import {
  activeIncidentCount,
  configDriftCount,
  connectionSummary,
  deployTotals,
} from "./dashboard-metrics";

const rollout = (
  status: string,
  successCount: number,
  failureCount: number,
) => ({ status, successCount, failureCount }) as never;

describe("deployTotals", () => {
  it("รวมเฉพาะ Rollout ที่ปล่อยแล้ว (active, paused, completed)", () => {
    expect(
      deployTotals([
        rollout("completed", 10, 2),
        rollout("active", 3, 0),
        rollout("paused", 1, 4),
        rollout("pending_approval", 99, 99),
        rollout("approved", 99, 99),
        rollout("rejected", 99, 99),
      ]),
    ).toEqual({ success: 14, failed: 6 });
  });

  it("ไม่มี Rollout: ศูนย์ทั้งคู่", () => {
    expect(deployTotals([])).toEqual({ success: 0, failed: 0 });
  });
});

describe("connectionSummary", () => {
  const ours = [{ deviceId: "A" }, { deviceId: "B" }, { deviceId: "C" }];

  it("จับคู่ด้วย deviceId: ออนไลน์ ออฟไลน์ และไม่ทราบ (Server กลางไม่รู้จัก)", () => {
    expect(
      connectionSummary(ours, [
        { deviceId: "A", online: true },
        { deviceId: "B", online: false },
        { deviceId: "OTHER", online: true },
      ]),
    ).toEqual({ online: 1, offline: 1, unknown: 1 });
  });

  it("กล่องที่ Server กลางรู้จักแต่ไม่อยู่ในระบบเรา ไม่นับ", () => {
    expect(
      connectionSummary([{ deviceId: "A" }], [
        { deviceId: "A", online: true },
        { deviceId: "Z", online: true },
        { deviceId: "Y", online: false },
      ]),
    ).toEqual({ online: 1, offline: 0, unknown: 0 });
  });

  it("Server กลางติดต่อไม่ได้ (รายการว่าง): ทุกเครื่องเป็นไม่ทราบ ไม่ใช่ออฟไลน์", () => {
    expect(connectionSummary(ours, [])).toEqual({
      online: 0,
      offline: 0,
      unknown: 3,
    });
  });
});

describe("configDriftCount", () => {
  const ours = [{ deviceId: "A" }, { deviceId: "B" }, { deviceId: "C" }];

  it("นับเครื่องที่ Config ที่กล่องรายงานไม่ตรงกับเป้าหมาย", () => {
    expect(
      configDriftCount(ours, [
        { deviceId: "A", desiredConfigVersion: 9, reportedConfigVersion: 8 },
        { deviceId: "B", desiredConfigVersion: 9, reportedConfigVersion: 9 },
        { deviceId: "C", desiredConfigVersion: 9, reportedConfigVersion: null },
      ]),
    ).toBe(2);
  });

  it("ไม่นับเครื่องที่ยังไม่เคยตั้งเป้า และเครื่องที่ไม่อยู่ในระบบเรา", () => {
    expect(
      configDriftCount(ours, [
        { deviceId: "A", desiredConfigVersion: null, reportedConfigVersion: 3 },
        { deviceId: "NOT-OURS", desiredConfigVersion: 9, reportedConfigVersion: 1 },
      ]),
    ).toBe(0);
  });
});

describe("activeIncidentCount", () => {
  it("นับเฉพาะ open และ investigating", () => {
    expect(
      activeIncidentCount([
        { status: "open" },
        { status: "investigating" },
        { status: "resolved" },
        { status: "dismissed" },
        { status: "rolled_back" },
      ] as never),
    ).toBe(2);
  });
});
