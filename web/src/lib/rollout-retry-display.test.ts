import { describe, expect, it } from "vitest";

import type { CampaignRolloutTarget } from "@/lib/campaign-api";
import {
  countRetryingTargets,
  filterTargetsByRetry,
  isTargetRetryExhausted,
  isTargetWaitingRetry,
  targetBadgeAttempt,
  targetHasHistory,
} from "./rollout-retry-display";

type T = Pick<
  CampaignRolloutTarget,
  "attemptCount" | "nextRetryAt" | "lastAttempt"
>;
const t = (over: Partial<T>): T => ({
  attemptCount: 1,
  nextRetryAt: null,
  lastAttempt: null,
  ...over,
});
const lastOf = (status: string): T["lastAttempt"] => ({
  attemptNo: 1,
  status,
  errorCode: null,
  detail: null,
  startedAt: "2026-11-09T00:00:00Z",
  finishedAt: null,
});

describe("rollout-retry-display: นับและกรองเครื่องที่ลองส่งใหม่", () => {
  const waiting = {
    status: "pending" as const,
    attemptCount: 1,
    nextRetryAt: "2026-11-09T00:00:30Z",
  };
  const exhausted = {
    status: "failed" as const,
    attemptCount: 3,
    nextRetryAt: null,
  };
  const failedFirst = {
    status: "failed" as const,
    attemptCount: 1,
    nextRetryAt: null,
  };
  const skippedExhausted = {
    status: "skipped_offline" as const,
    attemptCount: 3,
    nextRetryAt: null,
  };
  const skippedFirst = {
    status: "skipped_offline" as const,
    attemptCount: 1,
    nextRetryAt: null,
  };
  const ok = { status: "success" as const, attemptCount: 2, nextRetryAt: null };
  const all = [waiting, exhausted, failedFirst, skippedExhausted, ok];

  it("นับเฉพาะเครื่องที่รอส่งรอบใหม่", () => {
    expect(countRetryingTargets(all)).toBe(1);
  });

  it("ส่งครบทุกรอบไม่สำเร็จ = ล้มหรือออฟไลน์และส่งครบเพดาน (ล้มรอบแรกตอนปิดสวิตช์ไม่นับ)", () => {
    expect(isTargetRetryExhausted(exhausted)).toBe(true);
    expect(isTargetRetryExhausted(failedFirst)).toBe(false);
    // ออฟไลน์ครบทุกรอบก็นับ ออฟไลน์รอบแรกตอนปิดสวิตช์ไม่นับ
    expect(isTargetRetryExhausted(skippedExhausted)).toBe(true);
    expect(isTargetRetryExhausted(skippedFirst)).toBe(false);
    expect(isTargetRetryExhausted(ok)).toBe(false);
  });

  it("เพดานรอบตามค่าที่ส่งมา: ส่ง 3 รอบแต่เพดาน 5 ยังไม่ถือว่าครบทุกรอบ", () => {
    expect(isTargetRetryExhausted(exhausted, 5)).toBe(false);
    expect(isTargetRetryExhausted({ ...exhausted, attemptCount: 5 }, 5)).toBe(
      true,
    );
    expect(filterTargetsByRetry(all, "exhausted", 5)).toEqual([]);
    expect(targetBadgeAttempt(t({ attemptCount: 4 }), 5)).toBe(4);
    expect(targetBadgeAttempt(t({ attemptCount: 9 }), 5)).toBe(5);
  });

  it("กรองตามตัวเลือก", () => {
    expect(filterTargetsByRetry(all, "all")).toEqual(all);
    expect(filterTargetsByRetry(all, "retrying")).toEqual([waiting]);
    expect(filterTargetsByRetry(all, "exhausted")).toEqual([
      exhausted,
      skippedExhausted,
    ]);
  });
});

describe("rollout-retry-display", () => {
  it("รอบแรกยังไม่ล้ม: ไม่มีป้ายรอบ ไม่มีประวัติ", () => {
    expect(targetBadgeAttempt(t({}))).toBeNull();
    expect(targetHasHistory(t({ lastAttempt: lastOf("sent") }))).toBe(false);
  });

  it("รอรอบใหม่: ป้ายเป็นรอบที่กำลังจะส่ง (attemptCount + 1)", () => {
    const w = t({ attemptCount: 1, nextRetryAt: "2026-11-09T00:00:30Z" });
    expect(isTargetWaitingRetry(w)).toBe(true);
    expect(targetBadgeAttempt(w)).toBe(2);
    expect(
      targetBadgeAttempt(
        t({ attemptCount: 2, nextRetryAt: "2026-11-09T00:01:00Z" }),
      ),
    ).toBe(3);
  });

  it("ส่งรอบที่ 2 แล้ว (กำลังส่งหรือรอผล): ป้ายรอบ 2 และไม่เกินเพดาน 3", () => {
    expect(targetBadgeAttempt(t({ attemptCount: 2 }))).toBe(2);
    expect(targetBadgeAttempt(t({ attemptCount: 3 }))).toBe(3);
    expect(targetBadgeAttempt(t({ attemptCount: 9 }))).toBe(3);
  });

  it("ประวัติแสดงเมื่อหลายรอบ รอรอบใหม่ หรือรอบเดียวที่ล้มหรือถูกข้าม", () => {
    expect(targetHasHistory(t({ attemptCount: 2 }))).toBe(true);
    expect(targetHasHistory(t({ nextRetryAt: "2026-11-09T00:00:30Z" }))).toBe(
      true,
    );
    expect(targetHasHistory(t({ lastAttempt: lastOf("failed") }))).toBe(true);
    expect(targetHasHistory(t({ lastAttempt: lastOf("skipped") }))).toBe(true);
    expect(targetHasHistory(t({ lastAttempt: lastOf("succeeded") }))).toBe(
      false,
    );
  });
});
