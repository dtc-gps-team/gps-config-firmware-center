import { describe, expect, it } from "vitest";

import {
  badgeAttempt,
  failureTitle,
  formatMmSs,
  isWaitingRetry,
  lastFailureReason,
  retryCountdownText,
  showAttemptHistory,
} from "./field-apply-retry-display";
import type {
  FieldApplyAttempt,
  FieldApplyProgress,
} from "./field-apply-request-api";

const attempt = (
  attemptNo: number,
  status: string,
  detail: string | null = null,
): FieldApplyAttempt => ({
  attemptNo,
  status,
  errorCode: null,
  detail,
  startedAt: "2026-11-06T10:00:00Z",
  finishedAt: null,
});

function progress(
  over: Partial<FieldApplyProgress> & { retry?: FieldApplyProgress["retry"] },
): FieldApplyProgress {
  return {
    requestId: "r1",
    kind: "config",
    status: "sending",
    fromVersion: null,
    toVersion: null,
    releasedAt: null,
    completedAt: null,
    retry: null,
    ...over,
  };
}

const retry = (
  attemptNo: number,
  nextRetryAt: string | null,
  attempts: FieldApplyAttempt[] = [],
) => ({ attemptNo, maxAttempts: 3, nextRetryAt, attempts });

describe("badgeAttempt (ป้าย 'รอบ n/m')", () => {
  it("รอบแรก/ไม่มีข้อมูลรายรอบ -> ไม่แสดง", () => {
    expect(badgeAttempt(null)).toBeNull();
    expect(badgeAttempt(progress({ retry: null }))).toBeNull();
    expect(badgeAttempt(progress({ retry: retry(1, null) }))).toBeNull();
  });

  it("กำลังส่งรอบ 2 -> 2 · รอรอบใหม่ (หลังรอบ 1 ล้ม) -> เลขรอบที่กำลังจะส่งคือ 2", () => {
    expect(badgeAttempt(progress({ retry: retry(2, null) }))).toBe(2);
    expect(
      badgeAttempt(progress({ retry: retry(1, "2026-11-06T10:01:00Z") })),
    ).toBe(2);
  });

  it("maxAttempts = 1 -> ไม่แสดง", () => {
    expect(
      badgeAttempt(
        progress({
          retry: { attemptNo: 2, maxAttempts: 1, nextRetryAt: null, attempts: [] },
        }),
      ),
    ).toBeNull();
  });
});

describe("isWaitingRetry", () => {
  it("เฉพาะตอน sending และมี nextRetryAt", () => {
    expect(
      isWaitingRetry(progress({ retry: retry(1, "2026-11-06T10:01:00Z") })),
    ).toBe(true);
    expect(isWaitingRetry(progress({ retry: retry(1, null) }))).toBe(false);
    expect(
      isWaitingRetry(
        progress({ status: "failed", retry: retry(3, "2026-11-06T10:01:00Z") }),
      ),
    ).toBe(false);
    expect(isWaitingRetry(null)).toBe(false);
  });
});

describe("showAttemptHistory", () => {
  it("หลายรอบ หรือรอบเดียวที่ล้ม/ถูกข้าม -> แสดง · สำเร็จรอบแรก -> ไม่แสดง", () => {
    expect(showAttemptHistory([attempt(1, "succeeded")])).toBe(false);
    expect(showAttemptHistory([attempt(1, "sent")])).toBe(false);
    expect(showAttemptHistory([attempt(1, "failed")])).toBe(true);
    expect(showAttemptHistory([attempt(1, "skipped")])).toBe(true);
    expect(
      showAttemptHistory([attempt(1, "failed"), attempt(2, "succeeded")]),
    ).toBe(true);
  });
});

describe("retryCountdownText", () => {
  const next = "2026-11-06T10:01:00Z";
  const t = new Date(next).getTime();

  it("ยังไม่ถึงเวลา -> นับถอยหลังเป็น นาที:วินาที", () => {
    expect(retryCountdownText(next, t - 45_000)).toBe("จะลองส่งใหม่ในอีก 0:45");
    expect(retryCountdownText(next, t - 90_000)).toBe("จะลองส่งใหม่ในอีก 1:30");
  });

  it("ถึงเวลาแล้ว/เลยเวลา -> ส่งรอบใหม่แล้ว รอกล่องตอบ (ไม่ค้างที่ 0:00)", () => {
    expect(retryCountdownText(next, t)).toBe("ส่งรอบใหม่แล้ว รอกล่องตอบ");
    expect(retryCountdownText(next, t + 30_000)).toBe(
      "ส่งรอบใหม่แล้ว รอกล่องตอบ",
    );
  });

  it("formatMmSs ไม่ติดลบ", () => {
    expect(formatMmSs(-5)).toBe("0:00");
    expect(formatMmSs(65)).toBe("1:05");
  });
});

describe("failureTitle / lastFailureReason", () => {
  it("หลายรอบ -> 'ส่ง N ครั้งไม่สำเร็จ' · รอบเดียว -> 'ส่งไม่สำเร็จ'", () => {
    expect(failureTitle([attempt(1, "failed")])).toBe("ส่งไม่สำเร็จ");
    expect(
      failureTitle([attempt(1, "failed"), attempt(2, "failed"), attempt(3, "failed")]),
    ).toBe("ส่ง 3 ครั้งไม่สำเร็จ");
  });

  it("เหตุผลมาจากรอบล่าสุดที่ล้ม ไม่ใช่รอบที่สำเร็จหรือกำลังส่ง", () => {
    expect(
      lastFailureReason([
        attempt(1, "failed", "กล่องหลุด"),
        attempt(2, "failed", "กล่องไม่ตอบ"),
        attempt(3, "sending"),
      ]),
    ).toBe("กล่องไม่ตอบ");
    expect(lastFailureReason([attempt(1, "succeeded")])).toBeNull();
  });
});
