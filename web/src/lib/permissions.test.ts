import { describe, expect, it } from "vitest";

import { canManageDeviceModels } from "./permissions";

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
