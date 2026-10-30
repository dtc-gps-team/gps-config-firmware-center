import { describe, expect, it } from "vitest";

import { describeNotification } from "./notification-display";

function view(
  type: string,
  payload: Record<string, unknown> = {},
  role?: string | null,
) {
  return describeNotification({ type, payload }, role);
}

describe("describeNotification", () => {
  it("incident_report_pending: ด่วน + ลิงก์ไปหน้ารายละเอียด Incident + อุปกรณ์/หัวข้อ", () => {
    expect(
      view("incident_report_pending", {
        incidentId: "inc-1",
        deviceId: "DEV-0103",
        title: "ปุ่ม SOS ไม่ทำงาน",
      }),
    ).toEqual({
      title: "มีรายงานปัญหาหน้างานรอตัดสินใจ",
      details: ["อุปกรณ์: DEV-0103", "หัวข้อ: ปุ่ม SOS ไม่ทำงาน"],
      href: "/incidents/inc-1",
      urgent: true,
    });
  });

  it("incident_alert: ด่วน + ลิงก์ไป Config + โมเดล/โปรโตคอลคั่นด้วย / ไม่ใช้จุดกลาง", () => {
    const v = view("incident_alert", {
      configId: "cfg-9",
      deviceModel: "GT06N",
      protocol: "TCP",
      lastError: "connection timeout",
    });

    expect(v.urgent).toBe(true);
    expect(v.href).toBe("/config/cfg-9");
    expect(v.details).toEqual([
      "โมเดล/โปรโตคอล: GT06N / TCP",
      "ข้อผิดพลาด: connection timeout",
    ]);
  });

  it.each([
    ["incident_report_resolved", "รายงานปัญหาของคุณถูกปิดแล้ว (แก้ไขแล้ว)"],
    ["incident_report_dismissed", "รายงานปัญหาของคุณไม่ถูกดำเนินการ"],
    ["incident_report_promoted", "รายงานปัญหาของคุณถูกส่งต่อเป็น Campaign แก้ไข"],
  ])("%s: ไม่ด่วน แสดงหมายเหตุ ลิงก์ไป Incident", (type, title) => {
    const v = view(type, {
      incidentId: "inc-2",
      deviceId: "DEV-1",
      reviewNote: "ซ้ำกับรายการเดิม",
    });

    expect(v.title).toBe(title);
    expect(v.urgent).toBe(false);
    expect(v.href).toBe("/incidents/inc-2");
    expect(v.details).toContain("หมายเหตุ: ซ้ำกับรายการเดิม");
  });

  it("override pending (Config/Firmware): ไปหน้าอนุมัติ", () => {
    expect(view("config_override_pending", { deviceId: "DEV-1" }).href).toBe(
      "/approvals",
    );
    expect(view("firmware_override_pending", { deviceId: "DEV-1" }).href).toBe(
      "/approvals",
    );
  });

  it("override ผลตัดสินใจ: ไปหน้าอุปกรณ์ ถูกปฏิเสธมีเหตุผล อนุมัติไม่มี", () => {
    const rejected = view("config_override_rejected", {
      deviceId: "DEV-7",
      rejectReason: "ค่าไม่เหมาะสม",
    });
    expect(rejected.title).toBe("คำขอ Override ถูกปฏิเสธ");
    expect(rejected.href).toBe("/devices/DEV-7");
    expect(rejected.details).toContain("เหตุผล: ค่าไม่เหมาะสม");

    const approved = view("firmware_override_approved", { deviceId: "DEV-7" });
    expect(approved.title).toBe("คำขอ Firmware Override ได้รับการอนุมัติ");
    expect(approved.details).toEqual(["อุปกรณ์: DEV-7"]);
  });

  it("config_apply_pending: ไปหน้าอนุมัติ สลับ Config/Firmware ตาม kind", () => {
    const config = view("config_apply_pending", {
      deviceId: "DEV-1",
      kind: "config",
    });
    expect(config.title).toBe("มีคำขอส่ง Config เข้าเครื่องรออนุมัติ");
    expect(config.href).toBe("/approvals");
    expect(config.urgent).toBe(false);

    const firmware = view("config_apply_pending", {
      deviceId: "DEV-1",
      kind: "firmware",
    });
    expect(firmware.title).toBe("มีคำขอส่ง Firmware เข้าเครื่องรออนุมัติ");
  });

  it.each([
    [
      "config_apply_approved",
      "คำขอส่ง Config อนุมัติแล้ว — กดส่งเข้ากล่องได้",
    ],
    ["config_apply_succeeded", "กล่องรับ Config ที่คุณขอส่งแล้ว"],
    [
      "config_apply_expired",
      "คำขอส่ง Config ของคุณหมดอายุ (ไม่มีใครตัดสิน หรือไม่ได้กดส่งใน 24 ชม.)",
    ],
  ])("%s: ไม่ลิงก์ (เว็บไม่มีหน้างาน) ไม่ด่วน แสดงอุปกรณ์", (type, title) => {
    const v = view(type, { deviceId: "DEV-3", kind: "config" });
    expect(v.title).toBe(title);
    expect(v.href).toBeNull();
    expect(v.urgent).toBe(false);
    expect(v.details).toEqual(["อุปกรณ์: DEV-3"]);
  });

  it("config_apply_rejected: แสดงเหตุผลที่ปฏิเสธ", () => {
    const v = view("config_apply_rejected", {
      deviceId: "DEV-3",
      kind: "config",
      rejectReason: "ค่าไม่เหมาะกับโมเดลนี้",
    });
    expect(v.title).toBe("คำขอส่ง Config ของคุณถูกปฏิเสธ");
    expect(v.details).toEqual([
      "อุปกรณ์: DEV-3",
      "เหตุผล: ค่าไม่เหมาะกับโมเดลนี้",
    ]);
  });

  it("config_apply_failed (firmware): แสดงเหตุผลจาก detail และสลับคำเป็น Firmware", () => {
    const v = view("config_apply_failed", {
      deviceId: "DEV-3",
      kind: "firmware",
      detail: "กล่องออฟไลน์ระหว่างส่ง",
    });
    expect(v.title).toBe("ส่ง Firmware ที่คุณขอเข้าเครื่องไม่สำเร็จ");
    expect(v.details).toEqual([
      "อุปกรณ์: DEV-3",
      "เหตุผล: กล่องออฟไลน์ระหว่างส่ง",
    ]);
  });

  it("config_apply_succeeded/failed: backend ส่งให้ Operation ด้วย — ข้อความต้องไม่พูดว่า 'คุณขอ' และลิงก์ไปหน้าอุปกรณ์ได้ (รีวิว B #411)", () => {
    const succeeded = view(
      "config_apply_succeeded",
      { deviceId: "DEV-9", kind: "config" },
      "Operation",
    );
    expect(succeeded.title).toBe("กล่อง DEV-9 รับ Config ที่อนุมัติไว้แล้ว");
    expect(succeeded.title).not.toContain("คุณขอ");
    expect(succeeded.href).toBe("/devices/DEV-9");

    const failed = view(
      "config_apply_failed",
      { deviceId: "DEV-9", kind: "firmware", detail: "กล่องออฟไลน์" },
      "Operation",
    );
    expect(failed.title).toBe("ส่ง Firmware เข้ากล่อง DEV-9 ไม่สำเร็จ");
    expect(failed.title).not.toContain("คุณขอ");
    expect(failed.href).toBe("/devices/DEV-9");
    expect(failed.details).toContain("เหตุผล: กล่องออฟไลน์");
  });

  it("config_apply_succeeded/failed: role อื่น (ST/OT) หรือไม่ส่ง role มา ใช้ข้อความ/ลิงก์เดิม", () => {
    expect(
      view("config_apply_succeeded", { deviceId: "DEV-9" }, "ST").title,
    ).toBe("กล่องรับ Config ที่คุณขอส่งแล้ว");
    expect(
      view("config_apply_succeeded", { deviceId: "DEV-9" }, "ST").href,
    ).toBeNull();
    expect(view("config_apply_succeeded", { deviceId: "DEV-9" }).href).toBeNull();
  });

  it("config_deletion_pending / grace: ลิงก์ไป Config พร้อมชื่อ", () => {
    for (const type of ["config_deletion_pending", "config_deletion_grace"]) {
      const v = view(type, { configId: "cfg-1", configName: "Config กลาง" });
      expect(v.href).toBe("/config/cfg-1");
      expect(v.details).toEqual(["Config: Config กลาง"]);
    }
  });

  it("task_assigned: ไม่ลิงก์ (เว็บไม่มีหน้างาน)", () => {
    const v = view("task_assigned", { taskId: "t1", title: "ติดตั้งกล่อง" });
    expect(v.href).toBeNull();
    expect(v.details).toEqual(["งาน: ติดตั้งกล่อง"]);
  });

  it("ไม่มี id ใน payload: ไม่ลิงก์ ไม่เดาปลายทาง", () => {
    expect(view("incident_report_pending", {}).href).toBeNull();
    expect(view("config_override_approved", {}).href).toBeNull();
    expect(view("config_deletion_pending", {}).href).toBeNull();
  });

  it("ชนิดที่ไม่รู้จัก: ข้อความกลาง ไม่ error ไม่ลิงก์ ไม่ด่วน", () => {
    expect(view("something_new_from_backend", { x: 1 })).toEqual({
      title: "แจ้งเตือนใหม่",
      details: [],
      href: null,
      urgent: false,
    });
  });

  it("id ที่มีอักขระพิเศษถูก encode ใน URL", () => {
    expect(view("config_override_approved", { deviceId: "DEV 1/2" }).href).toBe(
      "/devices/DEV%201%2F2",
    );
  });

  it("ชนิดอื่นไม่ด่วนทั้งหมด", () => {
    for (const type of [
      "config_override_pending",
      "task_assigned",
      "config_approved",
      "config_deletion_pending",
      "config_apply_pending",
      "config_apply_approved",
      "config_apply_rejected",
      "config_apply_succeeded",
      "config_apply_failed",
      "config_apply_expired",
    ]) {
      expect(view(type).urgent).toBe(false);
    }
  });
});
