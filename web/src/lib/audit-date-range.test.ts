import { describe, expect, it } from "vitest";

import { dayRangeToIso } from "./audit-date-range";

describe("dayRangeToIso", () => {
  it("เลือกวันเดียว: ครอบทั้งวันตามเวลาไทย (รวมทั้งวัน)", () => {
    expect(dayRangeToIso("2026-10-14", "2026-10-14")).toEqual({
      from: "2026-10-13T17:00:00.000Z",
      to: "2026-10-14T16:59:59.999Z",
    });
  });

  it("เลือกด้านเดียว: อีกด้านเป็น undefined", () => {
    expect(dayRangeToIso("2026-10-14", "")).toEqual({
      from: "2026-10-13T17:00:00.000Z",
      to: undefined,
    });
    expect(dayRangeToIso("", "2026-10-14")).toEqual({
      from: undefined,
      to: "2026-10-14T16:59:59.999Z",
    });
  });

  it("ไม่เลือกเลย: ไม่กรอง", () => {
    expect(dayRangeToIso("", "")).toEqual({ from: undefined, to: undefined });
  });

  it("วันเริ่มต้นมากกว่าวันสิ้นสุด: คืน error ไม่คืนช่วง", () => {
    const r = dayRangeToIso("2026-10-15", "2026-10-14");
    expect(r.error).toBeTruthy();
    expect(r.from).toBeUndefined();
    expect(r.to).toBeUndefined();
  });

  it("รูปแบบวันที่ผิด: คืน error", () => {
    expect(dayRangeToIso("14/10/2026", "").error).toBeTruthy();
    expect(dayRangeToIso("2026-13-45", "").error).toBeTruthy();
  });
});
