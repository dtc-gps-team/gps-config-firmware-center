import { describe, expect, it } from "vitest";

import {
  hasActiveFilters,
  parseTableView,
  serializeTableView,
  type TableViewState,
} from "./table-url-state";

describe("table-url-state", () => {
  const state: TableViewState = {
    globalFilter: "GPS 01",
    sorting: [{ id: "deviceId", desc: true }],
    columnFilters: [
      { id: "status", value: ["ติดตั้งแล้ว", "ลงทะเบียนแล้ว"] },
      { id: "simNumber", value: "089" },
      { id: "registeredAt", value: ["2026-10-01", ""] },
    ],
  };

  it("round-trips search, sort and every filter kind", () => {
    const qs = serializeTableView(state);
    const parsed = parseTableView(qs);
    expect(parsed.globalFilter).toBe("GPS 01");
    expect(parsed.sorting).toEqual([{ id: "deviceId", desc: true }]);
    expect(parsed.columnFilters).toEqual(
      expect.arrayContaining([
        { id: "status", value: ["ติดตั้งแล้ว", "ลงทะเบียนแล้ว"] },
        { id: "simNumber", value: "089" },
        { id: "registeredAt", value: ["2026-10-01", ""] },
      ]),
    );
  });

  it("keeps unrelated params and drops owned ones when state is empty", () => {
    const qs = serializeTableView(
      { globalFilter: "", sorting: [], columnFilters: [] },
      "tab=config&q=old&sort=-x&m.a=1",
    );
    expect(qs).toBe("tab=config");
  });

  it("treats a two-value text multi-select as multi-select, not a range", () => {
    const qs = serializeTableView({
      globalFilter: "",
      sorting: [],
      columnFilters: [{ id: "model", value: ["A", "B"] }],
    });
    expect(parseTableView(qs).columnFilters).toEqual([
      { id: "model", value: ["A", "B"] },
    ]);
  });

  it("reports active filters", () => {
    expect(hasActiveFilters(parseTableView(""))).toBe(false);
    expect(hasActiveFilters(parseTableView("q=a"))).toBe(true);
    expect(hasActiveFilters(parseTableView("m.s=a"))).toBe(true);
  });
});
