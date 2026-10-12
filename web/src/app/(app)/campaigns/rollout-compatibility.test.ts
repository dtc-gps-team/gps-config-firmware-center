import { describe, expect, it } from "vitest";

import { describeIncompatibility } from "./rollout-compatibility";

const gt06nTcp = { deviceModel: "GT06N", protocol: "TCP" };

describe("describeIncompatibility", () => {
  it("ยังไม่ได้เลือก Config/Firmware -> ไม่มีอะไรให้เทียบ คืน null", () => {
    expect(
      describeIncompatibility({
        payloadType: "Config",
        device: gt06nTcp,
        config: null,
        firmware: null,
      }),
    ).toBeNull();
    expect(
      describeIncompatibility({
        payloadType: "Firmware",
        device: gt06nTcp,
        config: null,
        firmware: null,
      }),
    ).toBeNull();
  });

  it("Config: โมเดลและโปรโตคอลตรงกัน -> รับได้", () => {
    expect(
      describeIncompatibility({
        payloadType: "Config",
        device: gt06nTcp,
        config: { deviceModel: "GT06N", protocol: "TCP" },
        firmware: null,
      }),
    ).toBeNull();
  });

  it("Config: โมเดลไม่ตรง -> บอกโมเดลที่ต้องการ", () => {
    const reason = describeIncompatibility({
      payloadType: "Config",
      device: { deviceModel: "VT300", protocol: "TCP" },
      config: { deviceModel: "GT06N", protocol: "TCP" },
      firmware: null,
    });
    expect(reason).toContain("VT300");
    expect(reason).toContain("GT06N");
  });

  it("Config: โมเดลตรงแต่โปรโตคอลไม่ตรง -> บอกโปรโตคอลที่ต้องการ", () => {
    const reason = describeIncompatibility({
      payloadType: "Config",
      device: { deviceModel: "GT06N", protocol: "UDP" },
      config: { deviceModel: "GT06N", protocol: "TCP" },
      firmware: null,
    });
    expect(reason).toContain("โปรโตคอล");
    expect(reason).toContain("UDP");
    expect(reason).toContain("TCP");
  });

  it("Firmware: โมเดลอยู่ในรายการที่รองรับ -> รับได้ ไม่สนโปรโตคอล", () => {
    expect(
      describeIncompatibility({
        payloadType: "Firmware",
        device: { deviceModel: "GT06N", protocol: "UDP" },
        config: null,
        firmware: { deviceModelCompatibility: ["GT06N", "GT06L"] },
      }),
    ).toBeNull();
  });

  it("Firmware: โมเดลไม่อยู่ในรายการ -> บอกรายการที่รองรับ", () => {
    const reason = describeIncompatibility({
      payloadType: "Firmware",
      device: { deviceModel: "VT300", protocol: "TCP" },
      config: null,
      firmware: { deviceModelCompatibility: ["GT06N", "GT06L"] },
    });
    expect(reason).toContain("VT300");
    expect(reason).toContain("GT06N, GT06L");
  });

  it("เลือกประเภท Firmware แต่ยังถือ Config ค้างอยู่ -> ใช้ Firmware เป็นหลัก ไม่สนใจ Config", () => {
    expect(
      describeIncompatibility({
        payloadType: "Firmware",
        device: { deviceModel: "VT300", protocol: "TCP" },
        config: { deviceModel: "GT06N", protocol: "TCP" },
        firmware: null,
      }),
    ).toBeNull();
  });
});
