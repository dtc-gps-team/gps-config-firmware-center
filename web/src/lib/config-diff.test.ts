import { describe, expect, it } from "vitest";

import { diffConfigFields, isSameValue } from "./config-diff";

describe("isSameValue", () => {
  it("ค่าเดี่ยว: เท่ากันเมื่อเหมือนกัน และไม่เท่ากันเมื่อชนิดต่าง (8080 กับ '8080')", () => {
    expect(isSameValue(8080, 8080)).toBe(true);
    expect(isSameValue(8080, "8080")).toBe(false);
    expect(isSameValue(null, undefined)).toBe(false);
  });

  it("object/array เทียบตามเนื้อหา: ลำดับ key ไม่มีผล แต่ลำดับสมาชิก array มีผล", () => {
    expect(isSameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(isSameValue([1, 2], [2, 1])).toBe(false);
    expect(isSameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isSameValue([], {})).toBe(false);
  });
});

describe("diffConfigFields", () => {
  it("แยก เพิ่ม/แก้/ลบ พร้อมนับ และนับ field ที่ไม่เปลี่ยนแยกต่างหาก", () => {
    const diff = diffConfigFields(
      { KEEP: 1, EDIT: "a", GONE: true },
      { KEEP: 1, EDIT: "b", NEW: 5 },
    );

    expect(diff.changes).toEqual([
      { fieldName: "EDIT", kind: "changed", before: "a", after: "b" },
      { fieldName: "GONE", kind: "removed", before: true },
      { fieldName: "NEW", kind: "added", after: 5 },
    ]);
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(diff.unchangedCount).toBe(1);
  });

  it("ค่าเป็น object/array ที่เนื้อหาเท่ากันไม่ถูกนับเป็นการเปลี่ยน", () => {
    const diff = diffConfigFields({ LIST: [1, 2] }, { LIST: [1, 2] });

    expect(diff.changes).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("ค่าเดิมเป็น null แล้วเปลี่ยนเป็นค่า: นับเป็น changed ไม่ใช่ added", () => {
    const diff = diffConfigFields({ X: null }, { X: 1 });

    expect(diff.changes).toEqual([
      { fieldName: "X", kind: "changed", before: null, after: 1 },
    ]);
  });

  it("ทั้งสองฝั่งว่าง: ไม่มีอะไรเปลี่ยน", () => {
    const diff = diffConfigFields({}, {});

    expect(diff.changes).toEqual([]);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it("ผลเรียงตามชื่อ field", () => {
    const diff = diffConfigFields({}, { B: 1, A: 1, C: 1 });

    expect(diff.changes.map((c) => c.fieldName)).toEqual(["A", "B", "C"]);
  });
});
