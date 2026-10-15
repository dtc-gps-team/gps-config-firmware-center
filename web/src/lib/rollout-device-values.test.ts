import { describe, expect, it } from "vitest";

import {
  buildDeviceValues,
  continuesAutomatically,
  needsCarryChoice,
  parseFieldInput,
  valueToText,
} from "./rollout-device-values";
import type { RolloutDeviceValuesItem } from "@/lib/campaign-api";

function item(
  deviceId: string,
  overrides: Partial<RolloutDeviceValuesItem> = {},
): RolloutDeviceValuesItem {
  return {
    deviceId,
    hasPendingRequest: false,
    previous: {
      fields: { SPEED_LIMIT: 180 },
      dropped: [],
      fromConfigId: "cfg-old",
      overriddenBy: "st-1",
      overriddenAt: "2026-01-01T00:00:00Z",
      versionNumber: 1,
    },
    ...overrides,
  };
}

describe("parseFieldInput", () => {
  it("integer: รับจำนวนเต็ม ปฏิเสธทศนิยมและข้อความ", () => {
    const def = { dataType: "integer", allowedValues: [] };
    expect(parseFieldInput(def, " 180 ")).toEqual({ ok: true, value: 180 });
    expect(parseFieldInput(def, "-5")).toEqual({ ok: true, value: -5 });
    expect(parseFieldInput(def, "1.5").ok).toBe(false);
    expect(parseFieldInput(def, "เร็ว").ok).toBe(false);
  });

  it("decimal/boolean/json/array", () => {
    expect(
      parseFieldInput({ dataType: "decimal", allowedValues: [] }, "1.5"),
    ).toEqual({ ok: true, value: 1.5 });
    expect(
      parseFieldInput({ dataType: "boolean", allowedValues: [] }, "true"),
    ).toEqual({ ok: true, value: true });
    expect(
      parseFieldInput({ dataType: "boolean", allowedValues: [] }, "yes").ok,
    ).toBe(false);
    expect(
      parseFieldInput({ dataType: "json", allowedValues: [] }, '{"a":1}'),
    ).toEqual({ ok: true, value: { a: 1 } });
    expect(
      parseFieldInput({ dataType: "json", allowedValues: [] }, "[1]").ok,
    ).toBe(false);
    expect(
      parseFieldInput({ dataType: "array", allowedValues: [] }, "[1,2]"),
    ).toEqual({ ok: true, value: [1, 2] });
    expect(
      parseFieldInput({ dataType: "array", allowedValues: [] }, "{").ok,
    ).toBe(false);
  });

  it("string: ต้องอยู่ใน allowedValues เมื่อมีกำหนด", () => {
    const def = { dataType: "string", allowedValues: ["TCP", "UDP"] };
    expect(parseFieldInput(def, "UDP")).toEqual({ ok: true, value: "UDP" });
    expect(parseFieldInput(def, "HTTP").ok).toBe(false);
  });

  it("ว่างเปล่าไม่ผ่าน", () => {
    expect(
      parseFieldInput({ dataType: "string", allowedValues: [] }, "   ").ok,
    ).toBe(false);
  });
});

describe("valueToText", () => {
  it("string คงเดิม, อื่นๆ เป็น JSON, null เป็นว่าง", () => {
    expect(valueToText("a")).toBe("a");
    expect(valueToText(5)).toBe("5");
    expect(valueToText({ a: 1 })).toBe('{"a":1}');
    expect(valueToText(null)).toBe("");
  });
});

describe("needsCarryChoice / continuesAutomatically", () => {
  it("ค่าพิเศษเดิมจาก Config อื่น: ต้องเลือก", () => {
    expect(needsCarryChoice(item("D1"), "cfg-new")).toBe(true);
    expect(continuesAutomatically(item("D1"), "cfg-new")).toBe(false);
  });

  it("ค่าพิเศษเดิมผูกกับ Config เดียวกัน: ใช้ต่ออัตโนมัติ ไม่มีทางเลือก", () => {
    expect(needsCarryChoice(item("D1"), "cfg-old")).toBe(false);
    expect(continuesAutomatically(item("D1"), "cfg-old")).toBe(true);
  });

  it("ไม่มีค่าที่ใช้ต่อได้ (มีแต่ dropped) หรือไม่มี previous: ไม่ต้องเลือก", () => {
    const onlyDropped = item("D1", {
      previous: {
        fields: {},
        dropped: [{ fieldName: "X", reason: "ไม่รองรับ" }],
        fromConfigId: "cfg-old",
        overriddenBy: "st-1",
        overriddenAt: "2026-01-01T00:00:00Z",
        versionNumber: 1,
      },
    });
    expect(needsCarryChoice(onlyDropped, "cfg-new")).toBe(false);
    expect(needsCarryChoice(item("D1", { previous: null }), "cfg-new")).toBe(
      false,
    );
    expect(needsCarryChoice(undefined, "cfg-new")).toBe(false);
  });
});

describe("buildDeviceValues", () => {
  const base = {
    configId: "cfg-new",
    items: [item("D1"), item("D2", { previous: null })],
  };

  it("ใช้ค่าพิเศษเดิมต่อ: ค่าสุดท้ายคือค่าเดิมทับด้วยค่าที่แก้เอง", () => {
    const result = buildDeviceValues({
      ...base,
      includedDeviceIds: ["D1"],
      edits: { D1: { APN: "x", SPEED_LIMIT: 200 } },
      choices: { D1: "keep" },
    });

    expect(result.values).toEqual([
      { deviceId: "D1", fields: { SPEED_LIMIT: 200, APN: "x" } },
    ]);
  });

  it("ใช้ตามแม่แบบ: ไม่ส่งค่าเดิม และไม่ส่งอะไรเลยถ้าไม่แก้", () => {
    const result = buildDeviceValues({
      ...base,
      includedDeviceIds: ["D1"],
      edits: {},
      choices: { D1: "template" },
    });

    expect(result.values).toEqual([]);
    expect(result.missingChoices).toEqual([]);
  });

  it("ยังไม่เลือกสำหรับเครื่องที่มีค่าพิเศษเดิม: อยู่ใน missingChoices", () => {
    const result = buildDeviceValues({
      ...base,
      includedDeviceIds: ["D1", "D2"],
      edits: { D2: { APN: "x" } },
      choices: {},
    });

    expect(result.missingChoices).toEqual(["D1"]);
    expect(result.values).toEqual([
      { deviceId: "D2", fields: { APN: "x" } },
    ]);
  });

  it("เครื่องที่ไม่ได้อยู่ใน Rollout (ถูกเอาออก) ไม่ถูกส่ง แม้มีค่าที่แก้ไว้", () => {
    const result = buildDeviceValues({
      ...base,
      includedDeviceIds: ["D2"],
      edits: { D1: { APN: "x" } },
      choices: {},
    });

    expect(result.values).toEqual([]);
  });

  it("เครื่องที่มีคำขอของช่างค้างและถูกแก้ค่า: อยู่ใน blocked", () => {
    const result = buildDeviceValues({
      configId: "cfg-new",
      items: [item("D3", { previous: null, hasPendingRequest: true })],
      includedDeviceIds: ["D3"],
      edits: { D3: { APN: "x" } },
      choices: {},
    });

    expect(result.blocked).toEqual(["D3"]);
    expect(result.values).toEqual([]);
  });

  it("ค่าพิเศษเดิมผูกกับ Config เดียวกัน: ไม่ต้องเลือก ไม่ส่งค่าเดิมซ้ำ", () => {
    const result = buildDeviceValues({
      configId: "cfg-old",
      items: [item("D1")],
      includedDeviceIds: ["D1"],
      edits: {},
      choices: {},
    });

    expect(result.missingChoices).toEqual([]);
    expect(result.values).toEqual([]);
  });
});
