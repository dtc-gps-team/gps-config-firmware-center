import { describe, expect, it } from "vitest";

import {
  AUDIT_MODULE_OPTIONS,
  auditActivityText,
  auditModuleLabel,
} from "./audit-display";

describe("auditActivityText", () => {
  it.each([
    ["approve", "config", "อนุมัติ Config"],
    ["create", "device-model", "สร้าง รุ่นอุปกรณ์"],
    ["update", "config-definition", "แก้ไข พารามิเตอร์"],
    ["register", "device", "ลงทะเบียน อุปกรณ์"],
    ["start", "task", "เริ่ม งานหน้างาน"],
    ["deactivate", "customer", "ปิดใช้ ลูกค้า"],
    ["decide", "config", "ส่งผลทดสอบของ Config"],
  ])("%s + %s -> %s", (action, mod, text) => {
    expect(auditActivityText(action, mod)).toBe(text);
  });

  it("action ที่บอกเรื่องครบแล้วไม่ต่อชื่อโมดูลซ้ำ", () => {
    expect(
      auditActivityText("config_apply_cancel", "config-apply-request"),
    ).toBe("ยกเลิกคำขอส่งเข้ากล่อง");
    expect(
      auditActivityText("device-config-override-request", "device"),
    ).toBe("ขอ Override Config ของอุปกรณ์");
  });

  it("incident decide ใช้คำว่าตัดสิน ไม่ใช่ผลทดสอบ", () => {
    expect(auditActivityText("decide", "incident")).toBe("ตัดสิน Incident");
  });

  it("ค่าที่ไม่รู้จักแสดงค่าดิบ ไม่ error", () => {
    expect(auditActivityText("new_action", "new-module")).toBe(
      "new_action new-module",
    );
    expect(auditModuleLabel("new-module")).toBe("new-module");
  });
});

describe("AUDIT_MODULE_OPTIONS", () => {
  it("ครอบคลุมทุกโมดูลที่ backend เขียน AuditLog", () => {
    const values = AUDIT_MODULE_OPTIONS.map((o) => o.value);
    for (const m of [
      "config",
      "config-definition",
      "config-deletion",
      "config-apply-request",
      "firmware",
      "campaign",
      "device",
      "device-model",
      "incident",
      "task",
      "customer",
      "user",
    ]) {
      expect(values).toContain(m);
    }
  });
});
