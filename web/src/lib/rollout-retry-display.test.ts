import { describe, expect, it } from "vitest";

import type { CampaignRolloutTarget } from "@/lib/campaign-api";
import {
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
