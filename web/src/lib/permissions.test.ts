import { describe, expect, it } from "vitest";

import { canManageDeviceModels, canReadFirmware, visibleDeviceHistoryTypes } from "./permissions";

/**
 * เทสแรกของ permissions.ts ในโปรเจกต์ (ยังไม่เคยมี unit test ของไฟล์นี้มา
 * ก่อน — PR #273 review ข้อ 1(ค) ขอให้เริ่มด้วย canManageDeviceModels)
 * ขอบเขตแค่ฟังก์ชันนี้ตัวเดียวตามที่ PR นี้แตะ ไม่ขยายไปเทสทุกฟังก์ชันใน
 * ไฟล์ (คนละ scope — ทำทีหลังได้ถ้าต้องการ)
 */
describe("canManageDeviceModels", () => {
  it("Admin และ SuperAdmin จัดการ DeviceModel ได้", () => {
    expect(canManageDeviceModels("Admin")).toBe(true);
    expect(canManageDeviceModels("SuperAdmin")).toBe(true);
  });

  it("role อื่นทั้งหมดจัดการไม่ได้ (รวม role ที่ไม่รู้จัก/null/undefined)", () => {
    expect(canManageDeviceModels("ConfigEngineer")).toBe(false);
    expect(canManageDeviceModels("Operation")).toBe(false);
    expect(canManageDeviceModels("Auditor")).toBe(false);
    expect(canManageDeviceModels(null)).toBe(false);
    expect(canManageDeviceModels(undefined)).toBe(false);
  });
});

/** Device History filter pill (#378 รีวิว B บน #371) — mirror การกรองฝั่ง
 * backend ตาม seed.ts: `tasks:Read` และ `device-config-override`/
 * `device-firmware-override` grant */
describe("visibleDeviceHistoryTypes", () => {
  it("lifecycle/rollout/incident เห็นได้ทุก role (devices:Read/incidents:Read ให้ทุกคน)", () => {
    for (const role of [
      "ConfigEngineer",
      "FirmwareEngineer",
      "QAEngineer",
      "Operation",
      "ST",
      "OT",
      "Auditor",
      "Admin",
      "SuperAdmin",
      null,
      undefined,
    ]) {
      const types = visibleDeviceHistoryTypes(role);
      expect(types).toContain("lifecycle");
      expect(types).toContain("rollout");
      expect(types).toContain("incident");
    }
  });

  it("Operation/Auditor/Admin/SuperAdmin/ST/OT เห็นปุ่มงาน (มี tasks:Read)", () => {
    for (const role of [
      "Operation",
      "Auditor",
      "Admin",
      "SuperAdmin",
      "ST",
      "OT",
    ]) {
      expect(visibleDeviceHistoryTypes(role)).toContain("task");
    }
  });

  it("ConfigEngineer/FirmwareEngineer/QAEngineer ไม่เห็นปุ่มงาน (ไม่มี tasks:Read)", () => {
    for (const role of ["ConfigEngineer", "FirmwareEngineer", "QAEngineer"]) {
      expect(visibleDeviceHistoryTypes(role)).not.toContain("task");
    }
  });

  it("เฉพาะ Operation และ ST เห็นปุ่ม override (seed.ts ให้ ST เท่านั้น ไม่ให้ OT)", () => {
    expect(visibleDeviceHistoryTypes("Operation")).toContain("config-override");
    expect(visibleDeviceHistoryTypes("Operation")).toContain(
      "firmware-override",
    );
    expect(visibleDeviceHistoryTypes("ST")).toContain("config-override");
    expect(visibleDeviceHistoryTypes("ST")).toContain("firmware-override");

    for (const role of [
      "OT",
      "ConfigEngineer",
      "FirmwareEngineer",
      "QAEngineer",
      "Auditor",
      "Admin",
      "SuperAdmin",
    ]) {
      expect(visibleDeviceHistoryTypes(role)).not.toContain("config-override");
      expect(visibleDeviceHistoryTypes(role)).not.toContain(
        "firmware-override",
      );
    }
  });
});

describe("canReadFirmware", () => {
  it("ConfigEngineer และ role ที่ไม่รู้จักอ่าน Firmware ไม่ได้ ที่เหลือทุก role ได้", () => {
    expect(canReadFirmware("ConfigEngineer")).toBe(false);
    expect(canReadFirmware(undefined)).toBe(false);
    expect(canReadFirmware("SW")).toBe(false);
    for (const r of ["FirmwareEngineer", "QAEngineer", "Operation", "ST", "OT", "Auditor", "Admin", "SuperAdmin"]) {
      expect(canReadFirmware(r)).toBe(true);
    }
  });
});
