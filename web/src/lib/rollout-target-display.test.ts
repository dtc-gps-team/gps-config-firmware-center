import { describe, expect, it } from "vitest";

import {
  isAwaitingTargetResults,
  rolloutTargetStatusLabel,
  summarizeRolloutTargets,
} from "./rollout-target-display";

const t = (status: string) => ({ status }) as never;

describe("rolloutTargetStatusLabel", () => {
  it("ทุกสถานะที่รู้จักมีป้ายของตัวเอง และ skipped_offline ไม่ใช่ล้มเหลว", () => {
    expect(rolloutTargetStatusLabel("pending")).toBe("รอผล");
    expect(rolloutTargetStatusLabel("success")).toBe("สำเร็จ");
    expect(rolloutTargetStatusLabel("failed")).toBe("ล้มเหลว");
    expect(rolloutTargetStatusLabel("skipped_offline")).toBe("ข้าม (ออฟไลน์)");
  });

  it("สถานะที่ไม่รู้จักแสดงตามที่ได้รับ ไม่เหมารวมเป็นล้มเหลว", () => {
    expect(rolloutTargetStatusLabel("something_new")).toBe("something_new");
  });
});

describe("summarizeRolloutTargets", () => {
  it("นับแยกตามสถานะ", () => {
    expect(
      summarizeRolloutTargets([
        t("success"),
        t("success"),
        t("failed"),
        t("skipped_offline"),
        t("pending"),
      ]),
    ).toEqual({ total: 5, success: 2, failed: 1, skipped: 1, pending: 1 });
  });

  it("ไม่มีเป้าหมาย: ศูนย์ทั้งหมด", () => {
    expect(summarizeRolloutTargets([])).toEqual({
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    });
  });

  it("สถานะที่ไม่รู้จักนับเป็นรอผล (ไม่หายไปจากยอดรวม)", () => {
    expect(summarizeRolloutTargets([t("new_status")]).pending).toBe(1);
  });
});

describe("isAwaitingTargetResults", () => {
  it("active/paused และยังมีเครื่องรอผล -> true", () => {
    expect(isAwaitingTargetResults("active", [t("pending")])).toBe(true);
    expect(isAwaitingTargetResults("paused", [t("success"), t("pending")])).toBe(true);
  });

  it("ไม่มีเครื่องรอผลแล้ว -> false", () => {
    expect(isAwaitingTargetResults("active", [t("success"), t("skipped_offline")])).toBe(false);
  });

  it("Rollout ยังไม่ปล่อยหรือจบแล้ว -> false แม้จะมีเครื่อง pending", () => {
    for (const s of ["pending_approval", "approved", "rejected", "completed"] as const) {
      expect(isAwaitingTargetResults(s, [t("pending")])).toBe(false);
    }
  });
});
