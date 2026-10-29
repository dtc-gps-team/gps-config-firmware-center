import { describe, expect, it } from "vitest";

import {
  NAV_GROUPS,
  NAV_ITEMS,
  findActiveNavItem,
  visibleNavItems,
} from "./nav";

describe("NAV_ITEMS groups", () => {
  it("ทุกเมนูอยู่ในกลุ่มที่มีจริง", () => {
    const ids = new Set<string>(NAV_GROUPS.map((g) => g.id));
    for (const item of NAV_ITEMS) {
      expect(ids.has(item.group)).toBe(true);
    }
  });
});

describe("visibleNavItems", () => {
  it("ConfigEngineer ไม่เห็น Audit Log / User Management / Device Model", () => {
    const hrefs = visibleNavItems("ConfigEngineer").map((i) => i.href);
    expect(hrefs).not.toContain("/audit-log");
    expect(hrefs).not.toContain("/users");
    expect(hrefs).not.toContain("/device-models");
    expect(hrefs).toContain("/config");
  });

  it("Firmware Repository ซ่อนจาก ConfigEngineer (RBAC Matrix เป็น -) role อื่นเห็น", () => {
    expect(visibleNavItems("ConfigEngineer").map((i) => i.href)).not.toContain("/firmware");
    for (const role of ["FirmwareEngineer", "QAEngineer", "Operation", "ST", "OT", "Auditor", "Admin", "SuperAdmin"]) {
      expect(visibleNavItems(role).map((i) => i.href)).toContain("/firmware");
    }
  });

  it("ไม่มี session เห็นแค่เมนูที่ไม่จำกัด Role", () => {
    const items = visibleNavItems(undefined);
    expect(items.every((i) => !i.allowedRoles)).toBe(true);
  });
});

describe("findActiveNavItem", () => {
  const items = visibleNavItems("Admin");

  it("หน้าแรก match เฉพาะ / ตรงตัว", () => {
    expect(findActiveNavItem(items, "/")?.href).toBe("/");
    expect(findActiveNavItem(items, "/devices")?.href).toBe("/devices");
  });

  it("หน้าย่อยได้เมนูที่ครอบอยู่", () => {
    expect(findActiveNavItem(items, "/devices/GX50-001")?.href).toBe("/devices");
    expect(findActiveNavItem(items, "/campaigns/abc/rollouts/new")?.href).toBe(
      "/campaigns",
    );
  });

  it("ไม่ match prefix ที่ไม่ใช่ขอบ segment", () => {
    // /device-models ต้องไม่ถูกนับเป็นหน้าย่อยของ /devices
    expect(findActiveNavItem(items, "/device-models")?.href).toBe(
      "/device-models",
    );
  });

  it("ไม่มีเมนูไหนครอบ คืน null", () => {
    expect(findActiveNavItem(items, "/login")).toBeNull();
  });
});
