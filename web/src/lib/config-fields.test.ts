import { describe, expect, it } from "vitest";
import { flattenFields, nestFields } from "./config-fields";

describe("nestFields", () => {
  it("คีย์แบบมีจุดหลายชั้น -> object ซ้อนชั้น", () => {
    expect(
      nestFields({
        "gps.enabled": true,
        "gps.send_interval_sec": 10,
        "data_server.protocol": "https",
        "data_server.port": 443,
      }),
    ).toEqual({
      gps: { enabled: true, send_interval_sec: 10 },
      data_server: { protocol: "https", port: 443 },
    });
  });

  it("key ไม่มีจุดเลย (รุ่นเก่า เช่น GT06N) -> แบนเหมือนเดิม (no-op)", () => {
    expect(
      nestFields({ APN1: "internet", MTYP: "1", SIM1: "0812345678" }),
    ).toEqual({ APN1: "internet", MTYP: "1", SIM1: "0812345678" });
  });

  it("ไม่แปลงชนิดค่า (ตัวเลข/boolean คงเดิม)", () => {
    expect(nestFields({ "gps.send_interval_sec": 10, "gps.enabled": true })).toEqual({
      gps: { send_interval_sec: 10, enabled: true },
    });
  });

  it("object เปล่า -> {}", () => {
    expect(nestFields({})).toEqual({});
  });
});

describe("flattenFields (ตัวกลับของ nestFields — ใช้ preview ฝั่ง client)", () => {
  it("ซ้อนชั้น -> คีย์แบบมีจุด", () => {
    expect(
      flattenFields({
        gps: { enabled: true, send_interval_sec: 10 },
      }),
    ).toEqual({ "gps.enabled": true, "gps.send_interval_sec": 10 });
  });

  it("round-trip กับ nestFields ได้ค่าเดิม", () => {
    const flat = {
      "gps.enabled": true,
      "gps.send_interval_sec": 10,
      "data_server.protocol": "https",
    };
    expect(flattenFields(nestFields(flat))).toEqual(flat);
  });

  it("array เป็นค่าเดี่ยว ไม่ไล่ลงไปข้างใน", () => {
    expect(flattenFields({ allowed: ["a", "b"] })).toEqual({
      allowed: ["a", "b"],
    });
  });
});
